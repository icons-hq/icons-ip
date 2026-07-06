import type { Box2DModule } from './box2d-loader';
import { seededRng, seededShuffle } from './seed';

/* 마블 룰렛 물리 시뮬. 결과(보상)는 서버가 정하고 여기는 코스메틱 연출만 담당한다(ADR-0002).
 * (c1) 계약: 같은 시드 + 고정 타임스텝 + 같은 wasm 번들이면 헤드리스 사전 시뮬과
 * 화면 재생이 동일한 궤적·동일한 우승 구슬에 도달한다.
 * 회전 막대는 kinematic body(정확 적분)라 결정론을 깨지 않는다. */

export const FIXED_STEP = 1 / 60;
export const MARBLE_RADIUS = 0.32;
const GRAVITY_Y = 9.8;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
/** 안전 상한(2분) — 도달 시 가장 아래에 있는 구슬을 우승 처리해 종결을 보장한다 */
const MAX_STEPS = 7200;

export interface RouletteConfig {
  marbleCount: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Peg {
  x: number;
  y: number;
  r: number;
}

/** 회전 막대(핀볼 방해요소) — 시드로 초기 위상이 정해지고 일정 각속도로 돈다 */
export interface RotorDef {
  x: number;
  y: number;
  halfLength: number;
  thickness: number;
  omega: number; // rad/s (부호 = 방향)
}

export interface CourseGeometry {
  width: number;
  height: number;
  goalY: number;
  walls: Segment[];
  pegs: Peg[];
  bumpers: Peg[]; // 고반발 범퍼 — 부딪히면 튕겨 오른다
  rotors: RotorDef[];
}

export interface MarbleState {
  x: number;
  y: number;
  angle: number;
}

export interface RotorState {
  x: number;
  y: number;
  angle: number;
  halfLength: number;
  thickness: number;
}

function buildCourse(): CourseGeometry {
  const walls: Segment[] = [
    // 측벽
    { x1: 0.3, y1: 0, x2: 0.3, y2: 72 },
    { x1: 9.7, y1: 0, x2: 9.7, y2: 72 },
    // 깔때기 1 — 출발 구슬들을 중앙 틈으로 모은다
    { x1: 0.3, y1: 3.0, x2: 4.1, y2: 6.2 },
    { x1: 9.7, y1: 3.0, x2: 5.9, y2: 6.2 },
    // 지그재그 선반 A(3단) — 좌우로 흘려보내며 순위를 섞는다
    { x1: 0.3, y1: 25.0, x2: 6.9, y2: 26.6 },
    { x1: 9.7, y1: 28.4, x2: 3.1, y2: 30.0 },
    { x1: 0.3, y1: 31.8, x2: 6.9, y2: 33.4 },
    // 깔때기 2 — 범퍼 필드 이후 재수렴, 회전 게이트로 이어진다
    { x1: 0.3, y1: 46.0, x2: 4.2, y2: 49.0 },
    { x1: 9.7, y1: 46.0, x2: 5.8, y2: 49.0 },
    // 지그재그 선반 B(2단) — 최종 구간
    { x1: 9.7, y1: 61.5, x2: 3.0, y2: 63.2 },
    { x1: 0.3, y1: 64.8, x2: 7.0, y2: 66.4 },
  ];

  const pegs: Peg[] = [];
  // 못 필드 A
  for (let row = 0; row < 7; row++) {
    const y = 9.0 + row * 1.7;
    const offset = row % 2 === 1 ? 0.8 : 0;
    for (let x = 1.2 + offset; x <= 8.8; x += 1.6) {
      pegs.push({ x, y, r: 0.18 });
    }
  }
  // 못 필드 B
  for (let row = 0; row < 5; row++) {
    const y = 53.0 + row * 1.7;
    const offset = row % 2 === 1 ? 0.8 : 0;
    for (let x = 1.2 + offset; x <= 8.8; x += 1.6) {
      pegs.push({ x, y, r: 0.18 });
    }
  }

  // 범퍼 필드 — 고반발이라 맞으면 위로 튀어 오르기도 한다
  const bumpers: Peg[] = [
    { x: 2.0, y: 37.5, r: 0.5 },
    { x: 5.0, y: 36.5, r: 0.5 },
    { x: 8.0, y: 37.5, r: 0.5 },
    { x: 3.5, y: 40.0, r: 0.5 },
    { x: 6.5, y: 40.0, r: 0.5 },
    { x: 1.8, y: 42.5, r: 0.5 },
    { x: 5.0, y: 43.3, r: 0.5 },
    { x: 8.2, y: 42.5, r: 0.5 },
  ];

  // 회전 막대 — 구슬을 쳐올리거나 잠깐 막는 핀볼 요소
  const rotors: RotorDef[] = [
    { x: 3.2, y: 21.8, halfLength: 1.35, thickness: 0.28, omega: 1.9 },
    { x: 6.8, y: 22.6, halfLength: 1.35, thickness: 0.28, omega: -2.3 },
    { x: 5.0, y: 45.2, halfLength: 1.5, thickness: 0.28, omega: -2.0 },
    // 깔때기 2 출구 바로 아래의 게이트 — 병목 드라마
    { x: 5.0, y: 50.8, halfLength: 1.6, thickness: 0.3, omega: 1.6 },
  ];

  return { width: 10, height: 72, goalY: 69.5, walls, pegs, bumpers, rotors };
}

/** 코스 기하(미터, y-down) — 시뮬과 렌더러가 같은 데이터를 쓴다 */
export const COURSE: CourseGeometry = buildCourse();

export class RouletteSim {
  private readonly b2: Box2DModule;
  private readonly world: Box2D.b2World;
  private readonly bodies: Box2D.b2Body[] = [];
  private readonly rotorBodies: Box2D.b2Body[] = [];
  private stepCount = 0;
  private winnerIndex: number | null = null;

  constructor(b2: Box2DModule, seed: string, config: RouletteConfig) {
    this.b2 = b2;
    const rng = seededRng(seed);

    const gravity = new b2.b2Vec2(0, GRAVITY_Y);
    this.world = new b2.b2World(gravity);
    b2.destroy(gravity);

    // 정적 코스 — 벽·선반·깔때기는 엣지, 못은 원
    const staticDef = new b2.b2BodyDef();
    const staticBody = this.world.CreateBody(staticDef);
    b2.destroy(staticDef);

    const va = new b2.b2Vec2(0, 0);
    const vb = new b2.b2Vec2(0, 0);
    const edge = new b2.b2EdgeShape();
    for (const w of COURSE.walls) {
      va.Set(w.x1, w.y1);
      vb.Set(w.x2, w.y2);
      edge.SetTwoSided(va, vb);
      staticBody.CreateFixture(edge, 0);
    }
    b2.destroy(edge);

    const pegShape = new b2.b2CircleShape();
    const pegFixture = new b2.b2FixtureDef();
    pegFixture.set_shape(pegShape);
    pegFixture.set_friction(0.05);
    pegFixture.set_restitution(0.45);
    for (const p of COURSE.pegs) {
      pegShape.set_m_radius(p.r);
      pegShape.get_m_p().Set(p.x, p.y);
      staticBody.CreateFixture(pegFixture);
    }
    // 범퍼 — 반발계수 >1로 에너지를 더해 튕겨낸다
    pegFixture.set_restitution(1.15);
    for (const p of COURSE.bumpers) {
      pegShape.set_m_radius(p.r);
      pegShape.get_m_p().Set(p.x, p.y);
      staticBody.CreateFixture(pegFixture);
    }
    b2.destroy(pegFixture);
    b2.destroy(pegShape);

    // 회전 막대 — kinematic(질량 무한 취급)이라 구슬에 밀리지 않고 정확히 적분된다
    const rotorShape = new b2.b2PolygonShape();
    const rotorFixture = new b2.b2FixtureDef();
    rotorFixture.set_shape(rotorShape);
    rotorFixture.set_friction(0.1);
    rotorFixture.set_restitution(0.4);
    const rotorDef = new b2.b2BodyDef();
    rotorDef.set_type(b2.b2_kinematicBody);
    for (const r of COURSE.rotors) {
      va.Set(r.x, r.y);
      rotorDef.set_position(va);
      rotorDef.set_angle(rng() * Math.PI * 2); // 시드 위상 — 판마다 다른 타이밍
      rotorDef.set_angularVelocity(r.omega);
      const body = this.world.CreateBody(rotorDef);
      rotorShape.SetAsBox(r.halfLength, r.thickness / 2);
      body.CreateFixture(rotorFixture);
      this.rotorBodies.push(body);
    }
    b2.destroy(rotorDef);
    b2.destroy(rotorFixture);
    b2.destroy(rotorShape);

    // 구슬 — 시드로 레인 배치·미세 지터·초기 회전을 결정
    const lanes = seededShuffle(
      Array.from({ length: config.marbleCount }, (_, i) => i),
      rng,
    );
    const laneWidth = (COURSE.width - 2.6) / (config.marbleCount - 1);
    const marbleShape = new b2.b2CircleShape();
    marbleShape.set_m_radius(MARBLE_RADIUS);
    const marbleFixture = new b2.b2FixtureDef();
    marbleFixture.set_shape(marbleShape);
    marbleFixture.set_density(1);
    marbleFixture.set_friction(0.03);
    marbleFixture.set_restitution(0.42);
    const marbleDef = new b2.b2BodyDef();
    marbleDef.set_type(b2.b2_dynamicBody);
    for (let i = 0; i < config.marbleCount; i++) {
      const x = 1.3 + lanes[i] * laneWidth + (rng() - 0.5) * 0.24;
      const y = 1.0 + rng() * 0.5;
      va.Set(x, y);
      marbleDef.set_position(va);
      marbleDef.set_angularVelocity((rng() - 0.5) * 4);
      const body = this.world.CreateBody(marbleDef);
      body.CreateFixture(marbleFixture);
      this.bodies.push(body);
    }
    b2.destroy(marbleDef);
    b2.destroy(marbleFixture);
    b2.destroy(marbleShape);
    b2.destroy(va);
    b2.destroy(vb);
  }

  step(): void {
    if (this.winnerIndex !== null) return;
    this.world.Step(FIXED_STEP, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    this.stepCount++;

    let best = -1;
    let bestY = COURSE.goalY;
    for (let i = 0; i < this.bodies.length; i++) {
      const y = this.bodies[i].GetPosition().get_y();
      if (y > bestY) {
        bestY = y;
        best = i;
      }
    }
    if (best >= 0) {
      this.winnerIndex = best;
      return;
    }
    if (this.stepCount >= MAX_STEPS) {
      let lowest = 0;
      let lowestY = -Infinity;
      for (let i = 0; i < this.bodies.length; i++) {
        const y = this.bodies[i].GetPosition().get_y();
        if (y > lowestY) {
          lowestY = y;
          lowest = i;
        }
      }
      this.winnerIndex = lowest;
    }
  }

  get winner(): number | null {
    return this.winnerIndex;
  }

  get steps(): number {
    return this.stepCount;
  }

  getMarbles(): MarbleState[] {
    return this.bodies.map((body) => {
      const p = body.GetPosition();
      return { x: p.get_x(), y: p.get_y(), angle: body.GetAngle() };
    });
  }

  getRotors(): RotorState[] {
    return this.rotorBodies.map((body, i) => {
      const def = COURSE.rotors[i];
      return {
        x: def.x,
        y: def.y,
        angle: body.GetAngle(),
        halfLength: def.halfLength,
        thickness: def.thickness,
      };
    });
  }

  destroy(): void {
    this.b2.destroy(this.world);
  }
}

/** (c1) 헤드리스 사전 시뮬 — 우승 구슬을 미리 알아내 라벨을 배치하기 위한 고속 실행 */
export function findWinner(
  b2: Box2DModule,
  seed: string,
  config: RouletteConfig,
): { winner: number; steps: number } {
  const sim = new RouletteSim(b2, seed, config);
  while (sim.winner === null) sim.step();
  const result = { winner: sim.winner, steps: sim.steps };
  sim.destroy();
  return result;
}
