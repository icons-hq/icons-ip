import type { Box2DModule } from './box2d-loader';
import { seededRng, seededShuffle } from './seed';

/* 마블 룰렛 물리 시뮬. 결과(보상)는 서버가 정하고 여기는 코스메틱 연출만 담당한다(ADR-0002).
 * (c1) 계약: 같은 시드 + 고정 타임스텝 + 같은 wasm 번들이면 헤드리스 사전 시뮬과
 * 화면 재생이 동일한 궤적·동일한 우승 구슬에 도달한다. */

export const FIXED_STEP = 1 / 60;
export const MARBLE_RADIUS = 0.32;
const GRAVITY_Y = 9.8;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
/** 안전 상한(60초) — 도달 시 가장 아래에 있는 구슬을 우승 처리해 종결을 보장한다 */
const MAX_STEPS = 3600;

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

export interface CourseGeometry {
  width: number;
  height: number;
  goalY: number;
  walls: Segment[];
  pegs: Peg[];
}

export interface MarbleState {
  x: number;
  y: number;
  angle: number;
}

function buildCourse(): CourseGeometry {
  const walls: Segment[] = [
    // 측벽
    { x1: 0.3, y1: 0, x2: 0.3, y2: 24 },
    { x1: 9.7, y1: 0, x2: 9.7, y2: 24 },
    // 깔때기 — 출발 구슬들을 중앙 틈으로 모은다
    { x1: 0.3, y1: 3.0, x2: 4.1, y2: 5.6 },
    { x1: 9.7, y1: 3.0, x2: 5.9, y2: 5.6 },
    // 지그재그 선반
    { x1: 0.3, y1: 18.2, x2: 6.8, y2: 19.2 },
    { x1: 9.7, y1: 20.6, x2: 3.2, y2: 21.6 },
  ];
  const pegs: Peg[] = [];
  for (let row = 0; row < 6; row++) {
    const y = 7.6 + row * 1.6;
    const offset = row % 2 === 1 ? 0.8 : 0;
    for (let x = 1.2 + offset; x <= 8.8; x += 1.6) {
      pegs.push({ x, y, r: 0.18 });
    }
  }
  return { width: 10, height: 24, goalY: 23.2, walls, pegs };
}

/** 코스 기하(미터, y-down) — 시뮬과 렌더러가 같은 데이터를 쓴다 */
export const COURSE: CourseGeometry = buildCourse();

export class RouletteSim {
  private readonly b2: Box2DModule;
  private readonly world: Box2D.b2World;
  private readonly bodies: Box2D.b2Body[] = [];
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
    b2.destroy(pegFixture);
    b2.destroy(pegShape);

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
    marbleFixture.set_restitution(0.35);
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
