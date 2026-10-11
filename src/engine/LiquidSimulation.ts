import Matter from 'matter-js';

const STEP = 1 / 120;
export interface LiquidParameters {
  count: number;
  seed: number;
  radius: number;
  attraction: number;
  pointerX: number;
  pointerY: number;
}

export class LiquidSimulation {
  private engine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
  private bodies: Matter.Body[] = [];
  private signature = '';
  private time: number | null = null;
  private remainder = 0;

  update(time: number, parameters: LiquidParameters): Float32Array {
    const signature = JSON.stringify([parameters.count, parameters.seed, parameters.radius]);
    if (signature !== this.signature || this.time === null || time < this.time || time - this.time > 0.25) {
      this.reset();
      this.signature = signature;
      let seed = parameters.seed >>> 0;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const radius = parameters.radius * 1000;
      for (let index = 0; index < Math.floor(parameters.count); index++) {
        const body = Matter.Bodies.circle(150 + random() * 700, 150 + random() * 700, radius, { restitution: 0.7, frictionAir: 0.015, friction: 0 });
        Matter.Body.setVelocity(body, { x: (random() - 0.5) * 2, y: (random() - 0.5) * 2 });
        this.bodies.push(body);
      }
      Matter.Composite.add(this.engine.world, [
        ...this.bodies,
        Matter.Bodies.rectangle(-50, 500, 100, 1200, { isStatic: true }),
        Matter.Bodies.rectangle(1050, 500, 100, 1200, { isStatic: true }),
        Matter.Bodies.rectangle(500, -50, 1200, 100, { isStatic: true }),
        Matter.Bodies.rectangle(500, 1050, 1200, 100, { isStatic: true }),
      ]);
      this.time = time;
    }
    this.remainder += Math.max(0, time - (this.time ?? time));
    this.time = time;
    for (let step = 0; step < 30 && this.remainder + 1e-10 >= STEP; step++) {
      for (const body of this.bodies) {
        const deltaX = parameters.pointerX * 1000 - body.position.x;
        const deltaY = parameters.pointerY * 1000 - body.position.y;
        Matter.Body.applyForce(body, body.position, {
          x: deltaX * body.mass * parameters.attraction * 0.000001,
          y: deltaY * body.mass * parameters.attraction * 0.000001,
        });
      }
      Matter.Engine.update(this.engine, STEP * 1000);
      this.remainder = Math.max(0, this.remainder - STEP);
    }
    const positions = new Float32Array(32 * 2);
    this.bodies.forEach((body, index) => positions.set([body.position.x / 1000, body.position.y / 1000], index * 2));
    return positions;
  }

  reset() {
    Matter.Composite.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
    this.engine.timing.timestamp = 0;
    this.bodies = [];
    this.time = null;
    this.remainder = 0;
    this.signature = '';
  }
}