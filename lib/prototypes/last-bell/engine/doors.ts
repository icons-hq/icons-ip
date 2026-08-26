export type DoorVector = Readonly<{ x: number; y: number; z: number }>;

export type DoorTransform = Readonly<{
  position: DoorVector;
  rotation: DoorVector;
}>;

export type DoorBounds = Readonly<{
  min: DoorVector;
  max: DoorVector;
}>;

export type DoorLifecycle = 'closed' | 'opening' | 'open' | 'closing' | 'locked' | 'pressured';
export type DoorKind = 'slide' | 'hinge';

export type DoorCapability = Readonly<{
  id: string;
  kind: DoorKind;
  closedTransform: DoorTransform;
  pivot: DoorVector;
  axis: DoorVector;
  /** Slide distance in metres or hinge rotation in radians, depending on `kind`. */
  openAmount: number;
  durationSeconds: number;
  passableThreshold: number;
  blockerBounds: DoorBounds;
  lockId: string;
  pressureId: string;
  cueIds: Readonly<{
    opening: string;
    opened: string;
    closing: string;
    closed: string;
  }>;
}>;

export type DoorCommand = Readonly<{
  doorId: string;
  type: 'open' | 'close' | 'lock' | 'unlock';
}>;

export type DoorOccupant = Readonly<{
  id: string;
  bounds: DoorBounds;
}>;

export type DoorEvent = Readonly<{
  doorId: string;
  type: 'opening' | 'opened' | 'closing' | 'closed' | 'locked' | 'pressured' | 'unlocked';
  cueId?: string;
}>;

export type DoorSnapshot = Readonly<{
  id: string;
  state: DoorLifecycle;
  openProgress: number;
  passable: boolean;
  /** Actors currently intersecting this door's authored blocker volume. */
  occupants: readonly string[];
  render: Readonly<{
    kind: DoorKind;
    closedTransform: DoorTransform;
    pivot: DoorVector;
    axis: DoorVector;
    /** Translation for slides; angle in radians for hinges. */
    motionAmount: number;
  }>;
  blocker: Readonly<{
    bounds: DoorBounds;
    blocksCollider: boolean;
    blocksLineOfSight: boolean;
  }>;
}>;

export type DoorSystemSnapshot = Readonly<{
  doors: readonly DoorSnapshot[];
  /**
   * One serializable passability view for player collision, zombie navigation
   * and LOS. Consumers must not derive separate "open enough" thresholds.
   */
  passability: DoorPassabilitySnapshot;
  events: readonly DoorEvent[];
}>;

export type DoorPassabilitySnapshot = Readonly<{
  passableDoorIds: readonly string[];
  colliderBlockerDoorIds: readonly string[];
  lineOfSightBlockerDoorIds: readonly string[];
}>;

export type DoorSystemInput = Readonly<{
  deltaSeconds: number;
  commands?: readonly DoorCommand[];
  occupants?: readonly DoorOccupant[];
}>;

export type DoorValidationIssue = Readonly<{
  doorId: string;
  reason: string;
}>;

export const LAST_BELL_DOOR_FIXED_STEP = 1 / 30;

type DoorRuntime = {
  capability: DoorCapability;
  state: DoorLifecycle;
  openProgress: number;
  lockWhenClosed: boolean;
};

/**
 * Validates authored data before it can become a simulation source of truth.
 * The returned issues are intentionally serializable for asset-pipeline use.
 */
export function validateDoorCapabilities(capabilities: readonly DoorCapability[]): DoorValidationIssue[] {
  const issues: DoorValidationIssue[] = [];
  const ids = new Set<string>();
  for (const capability of capabilities) {
    const report = (reason: string) => issues.push({ doorId: capability.id || '(missing)', reason });
    if (!capability.id.trim()) report('door id is required');
    else if (ids.has(capability.id)) report('door id must be unique');
    ids.add(capability.id);
    if (!isFinitePositive(capability.openAmount)) report('openAmount must be positive');
    if (!isFinitePositive(capability.durationSeconds)) report('durationSeconds must be positive');
    if (!Number.isFinite(capability.passableThreshold) || capability.passableThreshold <= 0 || capability.passableThreshold > 1) {
      report('passableThreshold must be in (0, 1]');
    }
    if (!isVector(capability.closedTransform.position) || !isVector(capability.closedTransform.rotation) || !isVector(capability.pivot) || !isVector(capability.axis)) {
      report('authored transform, pivot, and axis must be finite');
    }
    if (Math.hypot(capability.axis.x, capability.axis.y, capability.axis.z) < .0001) report('axis must not be zero');
    if (!hasOrderedBounds(capability.blockerBounds)) report('blockerBounds must be ordered and finite');
    if (!capability.lockId.trim() || !capability.pressureId.trim()) report('lockId and pressureId are required');
    if (Object.values(capability.cueIds).some((cueId) => typeof cueId !== 'string' || !cueId.trim())) report('all door cue IDs are required');
  }
  return issues;
}

/**
 * A deterministic door simulation. It has no renderer, physics, or audio
 * dependency: one snapshot drives render motion, collision, and LOS together.
 */
export class DoorSystem {
  private readonly doors = new Map<string, DoorRuntime>();
  private readonly orderedDoorIds: string[];
  private accumulatorSeconds = 0;

  constructor(capabilities: readonly DoorCapability[]) {
    const issues = validateDoorCapabilities(capabilities);
    if (issues.length > 0) throw new Error(`Invalid door capability: ${issues[0].doorId} ${issues[0].reason}`);
    for (const capability of capabilities) {
      this.doors.set(capability.id, {
        capability,
        state: 'closed',
        openProgress: 0,
        lockWhenClosed: false,
      });
    }
    this.orderedDoorIds = capabilities.map((capability) => capability.id);
  }

  advance(input: DoorSystemInput): DoorSystemSnapshot {
    const events: DoorEvent[] = [];
    for (const command of input.commands ?? []) this.apply(command, events);

    this.accumulatorSeconds += Math.max(0, Number.isFinite(input.deltaSeconds) ? input.deltaSeconds : 0);
    const occupants = input.occupants ?? [];
    while (this.accumulatorSeconds + 1e-10 >= LAST_BELL_DOOR_FIXED_STEP) {
      for (const doorId of this.orderedDoorIds) this.step(this.doors.get(doorId)!, occupants, events);
      this.accumulatorSeconds -= LAST_BELL_DOOR_FIXED_STEP;
    }
    return this.toSnapshot(events, occupants);
  }

  snapshot(): DoorSystemSnapshot {
    return this.toSnapshot([]);
  }

  private apply(command: DoorCommand, events: DoorEvent[]): void {
    const door = this.doors.get(command.doorId);
    if (!door) return;
    if (command.type === 'open') {
      door.lockWhenClosed = false;
      if (door.state !== 'locked' && door.state !== 'open' && door.state !== 'opening') {
        door.state = 'opening';
        events.push(this.eventFor(door, 'opening'));
      }
      return;
    }

    if (command.type === 'close') {
      if (door.state !== 'locked' && door.state !== 'closed' && door.state !== 'closing') {
        door.state = 'closing';
        events.push(this.eventFor(door, 'closing'));
      }
      return;
    }

    if (command.type === 'lock') {
      door.lockWhenClosed = true;
      if (door.state === 'closed') {
        door.state = 'locked';
        events.push(this.eventFor(door, 'locked'));
      } else if (door.state !== 'locked' && door.state !== 'closing') {
        door.state = 'closing';
        events.push(this.eventFor(door, 'closing'));
      }
      return;
    }

    door.lockWhenClosed = false;
    if (door.state === 'locked') {
      door.state = 'closed';
      events.push(this.eventFor(door, 'unlocked'));
    }
  }

  private step(door: DoorRuntime, occupants: readonly DoorOccupant[], events: DoorEvent[]): void {
    const progressDelta = LAST_BELL_DOOR_FIXED_STEP / door.capability.durationSeconds;
    if (door.state === 'opening') {
      door.openProgress = Math.min(1, door.openProgress + progressDelta);
      if (door.openProgress >= 1) {
        door.state = 'open';
        events.push(this.eventFor(door, 'opened'));
      }
      return;
    }

    if (door.state === 'pressured') {
      if (door.openProgress < door.capability.passableThreshold) {
        door.openProgress = Math.min(
          door.capability.passableThreshold,
          door.openProgress + progressDelta,
        );
        return;
      }
      if (!isOccupied(door.capability.blockerBounds, occupants)) {
        door.state = 'closing';
        events.push(this.eventFor(door, 'closing'));
      }
      return;
    }

    if (door.state !== 'closing') return;
    if (isOccupied(door.capability.blockerBounds, occupants)) {
      door.state = 'pressured';
      events.push(this.eventFor(door, 'pressured'));
      return;
    }

    door.openProgress = Math.max(0, door.openProgress - progressDelta);
    if (door.openProgress <= 0) {
      door.state = door.lockWhenClosed ? 'locked' : 'closed';
      events.push(this.eventFor(door, door.lockWhenClosed ? 'locked' : 'closed'));
    }
  }

  private eventFor(door: DoorRuntime, type: DoorEvent['type']): DoorEvent {
    const { capability } = door;
    if (type === 'locked') return { doorId: capability.id, type, cueId: capability.lockId };
    if (type === 'pressured') return { doorId: capability.id, type, cueId: capability.pressureId };
    if (type === 'unlocked') return { doorId: capability.id, type };
    return { doorId: capability.id, type, cueId: capability.cueIds[type] };
  }

  private toSnapshot(events: readonly DoorEvent[], occupants: readonly DoorOccupant[] = []): DoorSystemSnapshot {
    const doors = this.orderedDoorIds.map((doorId) => {
      const door = this.doors.get(doorId)!;
      const passable = door.state === 'pressured'
        || (door.openProgress >= door.capability.passableThreshold && door.state !== 'locked');
      return {
        id: door.capability.id,
        state: door.state,
        openProgress: door.openProgress,
        passable,
        occupants: occupants
          .filter((occupant) => intersects(door.capability.blockerBounds, occupant.bounds))
          .map((occupant) => occupant.id),
        render: {
          kind: door.capability.kind,
          closedTransform: door.capability.closedTransform,
          pivot: door.capability.pivot,
          axis: door.capability.axis,
          motionAmount: door.capability.openAmount * door.openProgress,
        },
        blocker: {
          bounds: door.capability.blockerBounds,
          blocksCollider: !passable,
          blocksLineOfSight: !passable,
        },
      } as DoorSnapshot;
    });
    return {
      doors,
      passability: {
        passableDoorIds: doors.filter((door) => door.passable).map((door) => door.id),
        colliderBlockerDoorIds: doors.filter((door) => door.blocker.blocksCollider).map((door) => door.id),
        lineOfSightBlockerDoorIds: doors.filter((door) => door.blocker.blocksLineOfSight).map((door) => door.id),
      },
      events,
    };
  }
}

export function createDoorSystem(capabilities: readonly DoorCapability[]): DoorSystem {
  return new DoorSystem(capabilities);
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isVector(value: DoorVector): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function hasOrderedBounds(bounds: DoorBounds): boolean {
  return isVector(bounds.min)
    && isVector(bounds.max)
    && bounds.min.x <= bounds.max.x
    && bounds.min.y <= bounds.max.y
    && bounds.min.z <= bounds.max.z;
}

function isOccupied(blockerBounds: DoorBounds, occupants: readonly DoorOccupant[]): boolean {
  return occupants.some(({ bounds }) => intersects(blockerBounds, bounds));
}

function intersects(left: DoorBounds, right: DoorBounds): boolean {
  return left.min.x <= right.max.x && left.max.x >= right.min.x
    && left.min.y <= right.max.y && left.max.y >= right.min.y
    && left.min.z <= right.max.z && left.max.z >= right.min.z;
}
