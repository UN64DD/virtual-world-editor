import { clamp, wrapAngle } from '../core/util.js';
import { distToPolyEdge, distToSeg } from '../core/geom.js';
import { PROP_KINDS } from './schema.js';

/**
 * Self-driving simulator.
 *
 * Every autonomous vehicle in the world becomes an agent that follows the lane
 * graph: it tracks a centreline with a pure-pursuit controller on a kinematic
 * bicycle model, picks its own way through junctions, obeys speed limits, road
 * signals and blocked lanes, and keeps its distance to the car in front.
 */

export const DRIVE_STATE = {
  driving: 'driving',
  queued: 'queued',
  stopped: 'stopped',
  offroad: 'offroad',
  parked: 'parked',
};

const PLAN_LENGTH = 220;
const LOOKAHEAD_MIN = 8;
const LOOKAHEAD_MAX = 40;
const CURVATURE_HORIZON = 34;
const CURVATURE_MIN_SEG = 0.3;
const MAX_CURVATURE = 1.1;
const LATERAL_ACCEL = 3.4;
const MIN_GAP = 2.2;
const LEADER_RANGE = 45;
const LEADER_CONE = 0.44;
const SAME_DIRECTION = 1.22;
const HANDOVER_LEAD = 0.5;
const CROSS_K = 1.2;
const CROSS_SOFT = 1.5;
const MIN_AIM = 6;
const SMOOTH_PASSES = 6;
const JUNCTION_SETBACK_MIN = 3;
const JUNCTION_SETBACK_MAX = 4;
const CORNER_STEP = 1.5;
const HANDOVER_HEADING = 0.26;
const LOST_TOLERANCE = 12;
const JUNCTION_LOOKAHEAD = 30;
const JUNCTION_COMMITTED = 0.5;
const STOP_TOLERANCE = 0.2;
const DEADLOCK_ESCAPE = 5;
const CREEP_SPEED = 1.1;
const CREEP_CLEARANCE = 0.5;
const RESNAP_PERIOD = 1;
const SIGNAL_CYCLE = 26;
const STOP_SETBACK = 0.6;
const SNAP_RANGE = 10;

/**
 * Offset that keeps the approaches to one junction out of step with each other.
 * Keyed off where the junction is rather than its id, so the same crossing
 * always phases the same way however the world happens to be numbered.
 */
function signalPhaseOffset(node, lane) {
  const key = `${Math.round(node.x)}|${Math.round(node.y)}|${lane.index}|${lane.dir}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 1677767);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function signalState(node, lane, time) {
  if (!node || !node.signals) return 'none';
  const t = (time / SIGNAL_CYCLE + signalPhaseOffset(node, lane)) % 1;
  if (t < 0.46) return 'green';
  if (t < 0.58) return 'yellow';
  return 'red';
}

export class DriveSim {
  constructor(world, network, opts = {}) {
    this.world = world;
    this.network = network;
    this.running = false;
    this.time = 0;
    this.agents = new Map();
    this.radii = new Map();
    this._resnapIn = 0;
    this.onChange = opts.onChange || null;
  }

  /* -------------------------------------------------------------- control */

  start() {
    this.running = true;
    this.sync(true);
    this.onChange?.();
  }

  stop() {
    this.running = false;
    this.onChange?.();
  }

  toggle() {
    if (this.running) this.stop();
    else this.start();
    return this.running;
  }

  clear() {
    this.agents.clear();
    this.onChange?.();
  }

  agentFor(id) {
    return this.agents.get(id) || null;
  }

  /** Live agents, oldest first, for the renderers. */
  list() {
    return [...this.agents.values()];
  }

  /** Reconcile agents with the world: add new vehicles, drop deleted ones. */
  sync(resnap = false) {
    this.network.ensure();
    const vehicles = this.world.data.vehicles;
    for (const [id, agent] of this.agents) {
      const v = this.world.vehicleById(id);
      if (!v || v.autonomous === false) {
        this.agents.delete(id);
        this.onChange?.();
      } else if (resnap) {
        this.readSpec(agent, v);
        this.place(agent, v.x, v.y, v.yaw);
      } else {
        this.readSpec(agent, v);
        if (Math.hypot(v.x - agent.x, v.y - agent.y) > 0.75) this.place(agent, v.x, v.y, v.yaw);
      }
    }
    for (const v of vehicles) {
      if (v.autonomous === false || this.agents.has(v.id)) continue;
      const agent = this.spawn(v);
      this.agents.set(v.id, agent);
      this.onChange?.();
    }
  }

  /* ------------------------------------------------------------- stepping */

  /** Advance the fleet by dtMs of wall clock. Returns true if anything moved. */
  update(dtMs) {
    if (!this.running) return false;
    const dt = clamp(dtMs, 0, 120) / 1000;
    if (dt <= 0) return false;
    this.time += dt;
    this._resnapIn -= dt;
    const resnap = this._resnapIn <= 0;
    if (resnap) this._resnapIn = RESNAP_PERIOD;
    this.sync();
    let moved = false;
    for (const agent of this.agents.values()) {
      if (this.step(agent, dt, resnap)) moved = true;
    }
    return moved;
  }

  step(agent, dt, retryOffroad) {
    if (!agent.lane) {
      if (!retryOffroad) {
        agent.speed = 0;
        agent.state = DRIVE_STATE.offroad;
        return false;
      }
      const hit = this.laneUnder(agent.x, agent.y);
      if (hit) {
        this.place(agent, hit.x, hit.y, hit.heading);
      } else {
        agent.speed = 0;
        agent.state = DRIVE_STATE.offroad;
        return false;
      }
    }

    this.advanceOnLane(agent);
    if (this.recheckLane(agent)) return false;
    if (!agent.plan || agent.plan.laneId !== agent.laneId || agent.arc > agent.plan.total - LOOKAHEAD_MAX) {
      this.buildPlan(agent);
    } else {
      this.track(agent);
    }

    agent.speed = Math.max(0, agent.speed - agent.drag * dt);
    const target = this.targetSpeed(agent);
    const dv = target - agent.speed;
    const accel = dv > 0 ? Math.min(agent.accel, dv / dt) : Math.max(-agent.brake, dv / dt);
    agent.speed = clamp(agent.speed + accel * dt, 0, agent.maxSpeed / 3.6);
    agent.targetSpeed = target;

    const ds = agent.speed * dt;
    if (ds > 1e-6) {
      agent.steer = this.steerFor(agent);
      agent.yaw = wrapAngle(agent.yaw + ((agent.speed / Math.max(0.5, agent.wheelbase)) * Math.tan(agent.steer)) * dt);
      agent.x += Math.cos(agent.yaw) * ds;
      agent.y += Math.sin(agent.yaw) * ds;
      agent.distance += ds;
    }

    agent.reason = this.reason(agent, target);
    agent.state = agent.speed > 0.4 ? DRIVE_STATE.driving : agent.reason === 'queued' ? DRIVE_STATE.queued : DRIVE_STATE.stopped;
    if (agent.speed < 0.2) agent.stuckAt = agent.stuckAt ?? this.time;
    else agent.stuckAt = null;

    const v = this.world.vehicleById(agent.id);
    if (v) {
      v.x = agent.x;
      v.y = agent.y;
      v.yaw = agent.yaw;
    }
    return ds > 1e-6;
  }

  reason(agent, target) {
    if (!agent.lane) return 'off road';
    if (agent.speed < 0.2 && target < 0.2) {
      if (agent.signal && agent.signal !== 'green') return `stopped at ${agent.signal} light`;
      if (agent.yielded) return 'giving way';
      if (agent.leader) return 'waiting for traffic';
      if (agent.blocked) return 'blocked ahead';
      if (agent.lane.successors.length === 0) return 'end of the road';
    }
    return '';
  }

  /* -------------------------------------------------------- graph tracking */

  /** Keep (laneId, s) in step with where the body actually is. */
  advanceOnLane(agent) {
    const lane = agent.lane;
    const proj = this.network.projectOnLane(lane, agent.x, agent.y);
    if (proj) agent.s = proj.s;
    // Hand over where the plan says the successor lane begins. Projecting onto
    // the successor cannot decide this: while the body is still on the junction
    // curve the projection is clamped to its first segment and reads s = 0.
    const plan = agent.plan;
    if (!plan || plan.laneId !== lane.id) return;
    if (!plan.nextLaneId || agent.arc < plan.handoverArc - HANDOVER_LEAD) return;
    const next = this.network.lanes.get(plan.nextLaneId);
    if (!next) return;
    const onto = this.network.projectOnLane(next, agent.x, agent.y);
    if (!onto) return;
    // Wait until the body is actually pointing down the new lane. Pure pursuit
    // cuts junctions slightly, so the car can reach the handover arc still
    // halfway round the turn; taking the lane there would start the next plan
    // with a heading error far too big to steer out of.
    if (Math.abs(onto.lateral) > next.width * 0.6) return;
    const head = this.network.pointAtS(next, onto.s).heading;
    if (Math.abs(wrapAngle(agent.yaw - head)) > HANDOVER_HEADING) return;
    agent.laneId = next.id;
    agent.lane = next;
    agent.s = Math.max(0, onto.s);
    agent.plan = null;
    this.remember(agent, next.id);
  }

  /**
   * Safety net. A car should never end up metres from the road it is booked on,
   * but if it does the lane has to be re-acquired or the plan will double back
   * on itself trying to catch up.
   */
  recheckLane(agent) {
    const proj = this.network.projectOnLane(agent.lane, agent.x, agent.y);
    // Use the real distance to the centreline: past the end of a lane the
    // projection lands on the last vertex, where the sideways offset reads
    // small however far the body has actually run on past it.
    if (!proj || proj.distance <= LOST_TOLERANCE) return false;
    const hit = this.laneUnder(agent.x, agent.y);
    if (!hit) {
      agent.lane = null;
      agent.laneId = null;
      agent.plan = null;
      agent.speed = 0;
      agent.state = DRIVE_STATE.offroad;
      agent.reason = 'lost the road';
      return true;
    }
    this.place(agent, hit.x, hit.y, hit.heading);
    return true;
  }

  /**
   * Pick the lane to continue along. Straight beats a turn, a turn beats a
   * sharp one, and recently driven lanes are pushed down so a vehicle tours
   * the network instead of circling the first block forever.
   */
  chooseSuccessor(agent, lane, recent = agent.recent) {
    let best = null;
    let bestScore = Infinity;
    for (const succ of lane.successors || []) {
      // Turning back on yourself only ever happens at the end of a cul-de-sac,
      // and there the swing is wider than the junction: nobody should plan for
      // it. A dead end is a terminus, not a route, so keep well clear of one.
      if (succ.turn === 'uturn') continue;
      let score = TURN_COST[succ.turn] ?? 3;
      score += this.recency(recent, succ.laneId);
      if (!succ.lane.successors.length) score += DEAD_END_COST;
      score -= (succ.lane.speedLimit - lane.speedLimit) / 400;
      if (score < bestScore) {
        bestScore = score;
        best = succ;
      }
    }
    return best;
  }

  recency(recent, laneId) {
    const n = recent.length;
    for (let i = 0; i < n; i++) {
      if (recent[i] === laneId) return 9 * (1 - (i + 1) / (n + 1));
    }
    return 0;
  }

  remember(agent, laneId) {
    agent.recent.unshift(laneId);
    if (agent.recent.length > 14) agent.recent.pop();
  }

  /* ------------------------------------------------------------- planning */

  /**
   * Look-ahead path: this lane, then on through upcoming junctions.
   *
   * Lane centres run right up to the node they meet at, so a turn is a corner
   * with barely a couple of metres between the two lanes, and nothing with a
   * real wheelbase can steer that. The plan therefore holds each lane back from
   * the junction by as much as this body needs to swing round it, and joins the
   * two with a curve through the corner itself. A long vehicle takes a wider
   * line across the junction, exactly as it would have to in the real thing.
   */
  buildPlan(agent) {
    const net = this.network;
    const radius = agent.wheelbase / Math.tan(agent.maxSteer);
    const setback = clamp(radius * 0.8, JUNCTION_SETBACK_MIN, JUNCTION_SETBACK_MAX);
    const startS = Math.min(agent.s, Math.max(0, agent.lane.length - 0.01));
    const from = net.pointAtS(agent.lane, startS);
    const pts = [{ x: from.x, y: from.y, s: 0 }];
    let total = 0;
    const push = (p) => {
      const last = pts[pts.length - 1];
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < 1e-4) return;
      total += d;
      pts.push({ x: p.x, y: p.y, s: total });
    };
    const addCentre = (lane, s0, s1) => {
      const a = net.pointAtS(lane, s0);
      push(a);
      const end = net.pointAtS(lane, Math.max(s0, s1)).index;
      for (let i = a.index + 1; i <= end && i < lane.center.length; i++) push(lane.center[i]);
    };
    // Never hold back more than half of what is left, so a lane always keeps
    // going forward and short lanes do not fold back on themselves.
    const holdBack = (lane, s) => Math.min(setback, Math.max(0, (lane.length - s) / 2));
    let lane = agent.lane;
    let s = startS;
    let nextLaneId = null;
    let handoverArc = null;
    const recent = agent.recent.slice();
    let guard = 0;
    while (total < PLAN_LENGTH && guard++ < 24) {
      addCentre(lane, s, s + holdBack(lane, s));
      const succ = this.chooseSuccessor(agent, lane, recent);
      if (!succ) break;
      recent.unshift(succ.laneId);
      if (recent.length > 14) recent.pop();
      const next = succ.lane;
      const entry = Math.min(setback, Math.max(0, (next.length - 0.01) / 2));
      for (const p of this.corner(net.pointAtS(lane, s + holdBack(lane, s)), net.pointAtS(next, entry))) push(p);
      // Only the first hop matters: that is the lane this body is about to enter.
      if (nextLaneId === null) {
        nextLaneId = succ.laneId;
        handoverArc = total;
      }
      lane = next;
      s = entry;
    }
    if (pts.length < 2) {
      // Nowhere left to go (dead end and already at the end of the lane): give
      // the controller a straight ahead reference so the car rolls to a stop
      // instead of trying to turn round on the spot.
      push({ x: from.x + Math.cos(from.heading) * 6, y: from.y + Math.sin(from.heading) * 6 });
    }
    total = this.smoothPlan(pts, agent);
    agent.plan = { laneId: agent.laneId, nextLaneId, handoverArc, pts, total };
    agent.trackIndex = 1;
    this.track(agent);
  }

  /**
   * Curve from one lane to the next, rounded off at the corner where the two
   * centrelines cross. Taking the curve through that crossing keeps it inside
   * the triangle the lane ends and the corner make up, so it cannot double back
   * on itself the way a pair of fixed length tangent handles can.
   */
  corner(a, b) {
    const ax = Math.cos(a.heading);
    const ay = Math.sin(a.heading);
    const bx = Math.cos(b.heading);
    const by = Math.sin(b.heading);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    let ctrl = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const den = ax * by - ay * bx;
    if (Math.abs(den) > 1e-6) {
      const t = ((b.x - a.x) * by - (b.y - a.y) * bx) / den;
      const px = a.x + ax * t;
      const py = a.y + ay * t;
      // A shallow join puts the crossing a long way off. Keep the bulge in
      // proportion to the gap so the curve stays between the two lanes.
      const off = Math.hypot(px - ctrl.x, py - ctrl.y);
      const reach = Math.max(1e-3, d * 0.5);
      const k = off > reach ? reach / off : 1;
      ctrl = { x: a.x + (px - a.x) * k, y: a.y + (py - a.y) * k };
    }
    const samples = clamp(Math.ceil(d / CORNER_STEP), 2, 24);
    const out = [];
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const u = 1 - t;
      out.push({
        x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
      });
    }
    return out;
  }

  /**
   * Round off the corners where lanes are stitched together. A junction fillet
   * is far tighter than anything can steer, and a path nobody can follow is a
   * path the body ends up fighting: it drives wide, loses the aim point and
   * then circles. Averaging each point with its neighbours leaves straights
   * untouched and turns the fillet into a curve that can be driven, which is
   * also what a real driver does by swinging across the junction.
   */
  smoothPlan(pts, agent) {
    // Round each corner as widely as this body can steer. A junction fillet is
    // a couple of metres across, which nothing with a real wheelbase can follow,
    // so a long vehicle is given a plan that cuts the corner wide and rejoins
    // the road beyond it rather than one it has to fight.
    const radius = agent.wheelbase / Math.tan(agent.maxSteer);
    const shift = clamp(radius * 0.6, 1, 6);
    let work = pts;
    for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
      const next = work.map((p) => ({ x: p.x, y: p.y, s: p.s }));
      for (let i = 1; i < work.length - 1; i++) {
        const before = work[i - 1];
        const after = work[i + 1];
        const mx = (before.x + after.x) / 2;
        const my = (before.y + after.y) / 2;
        const dx = mx - work[i].x;
        const dy = my - work[i].y;
        const d = Math.hypot(dx, dy);
        // Bound the move by the gap between the neighbouring samples as well as
        // by the body: without it the passes compound and the corner's
        // direction creeps back along the approach, leaving the plan metres
        // off the centreline long before the junction.
        const span = Math.hypot(after.x - before.x, after.y - before.y);
        const limit = Math.min(shift, span * 0.5);
        if (d > limit && limit > 0) {
          const k = limit / d;
          next[i].x = work[i].x + dx * k;
          next[i].y = work[i].y + dy * k;
        }
      }
      work = next;
    }
    // Recompute the arc so look-ahead distances and the handover point still
    // mean what they did before the corners moved.
    let total = 0;
    work[0].s = 0;
    for (let i = 1; i < work.length; i++) {
      total += Math.hypot(work[i].x - work[i - 1].x, work[i].y - work[i - 1].y);
      work[i].s = total;
    }
    work.total = total;
    if (pts !== work) for (let i = 0; i < work.length; i++) pts[i] = work[i];
    return total;
  }

  planPoint(plan, dist) {
    const pts = plan.pts;
    const last = pts[pts.length - 1];
    if (!pts.length) return { x: 0, y: 0, s: 0 };
    if (dist <= 0) return pts[0];
    if (dist >= plan.total) return last;
    let i = 1;
    while (i < pts.length - 1 && pts[i].s < dist) i++;
    const a = pts[i - 1];
    const b = pts[i];
    const seg = b.s - a.s || 1;
    const t = clamp((dist - a.s) / seg, 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: dist };
  }

  /* --------------------------------------------------------- speed control */

  targetSpeed(agent) {
    const lane = agent.lane;
    agent.leader = null;
    agent.blocked = null;
    if (!lane || !lane.drivable) return 0;
    const limit = Math.min(lane.speedLimit, agent.maxSpeed) / 3.6;
    let target = limit;

    const curvature = this.planCurvature(agent);
    if (curvature > 1e-4) target = Math.min(target, Math.sqrt(LATERAL_ACCEL / curvature));

    agent.signal = this.signalFor(agent);
    if (agent.signal && agent.signal !== 'green') target = Math.min(target, this.signalTarget(agent));

    target = Math.min(target, this.junctionTarget(agent));

    target = Math.min(target, this.leaderTarget(agent));
    target = Math.min(target, this.obstacleTarget(agent));
    target = this.unstick(agent, target);

    if (!lane.successors.length) {
      const room = Math.max(0, lane.length - agent.s - 1.5);
      target = Math.min(target, Math.sqrt(2 * agent.brake * 0.7 * room));
    }
    return Math.max(0, target);
  }

  /** Sharpest turn inside the planning horizon, as a curvature in 1/m. */
  planCurvature(agent) {
    const plan = agent.plan;
    if (!plan || plan.pts.length < 3) return 0;
    const from = this.planPoint(plan, agent.arc + 1.5);
    let heading = Math.atan2(from.y - agent.y, from.x - agent.x);
    let walked = 0;
    let worst = 0;
    let prev = from;
    for (const p of plan.pts) {
      if (p.s <= from.s) continue;
      const seg = Math.hypot(p.x - prev.x, p.y - prev.y);
      if (seg < 1e-6) continue;
      const h = Math.atan2(p.y - prev.y, p.x - prev.x);
      if (seg >= CURVATURE_MIN_SEG) {
        worst = Math.max(worst, Math.abs(wrapAngle(h - heading)) / seg);
      }
      heading = h;
      prev = p;
      walked += seg;
      if (walked > CURVATURE_HORIZON) break;
    }
    return Math.min(worst, MAX_CURVATURE);
  }

  signalFor(agent) {
    const node = this.world.nodeById(agent.lane.to);
    const state = signalState(node, agent.lane, this.time);
    return state === 'none' ? null : state;
  }

  signalTarget(agent) {
    const stopS = agent.lane.length - this.stopS(agent);
    const d = stopS - agent.s;
    if (d <= 0) return Infinity;
    if (agent.signal === 'yellow' && d < this.brakingDistance(agent) * 1.3) return Infinity;
    // Sit at the line rather than crawling across it: without the dead band the
    // square-root profile never quite reaches zero and the car creeps on red.
    if (d <= STOP_TOLERANCE) return 0;
    return Math.sqrt(2 * agent.brake * 0.75 * (d - STOP_TOLERANCE));
  }

  /**
   * Right of way in a junction.
   *
   * Distance from the node is no use on its own: two approaches can both be
   * metres away and still be on a collision course. So a junction is held by
   * one body at a time. Whoever is level with the stop line first takes it and
   * keeps it until they are clear on the other side; everyone else brakes for
   * the line. Holding back until the road beyond the junction has room keeps a
   * queue from nosing over the stop line and locking the whole thing up, and a
   * claim held by something wedged is taken over once it has clearly stopped
   * moving. Cross-stream traffic is ignored by the leader test on purpose.
   */
  junctionTarget(agent) {
    agent.yielded = null;
    const lane = agent.lane;
    const gap = lane.length - this.stopS(agent) - agent.s;
    if (gap > JUNCTION_LOOKAHEAD) return Infinity;
    // Past the stop line there is nothing to hold back for: clearing the box
    // beats politeness, and beats being blocked by whatever is crossing it.
    if (gap <= JUNCTION_COMMITTED) return Infinity;
    const node = this.world.nodeById(lane.to);
    if (!node || node.stopLine === false || !this.isJunction(node.id)) return Infinity;
    // Hold at the line only while somebody is actually standing in the box.
    // Turning the junction into a reservation was tried and thrown away: on
    // this map bodies never touch even with every approach running free, and
    // queues built up behind the holder.
    const blocking = this.boxOccupied(node, agent, this.junctionRadius(node));
    if (!blocking) return Infinity;
    agent.yielded = blocking;
    return Math.sqrt(2 * agent.brake * 0.7 * Math.max(0, gap));
  }

  /** True when a node is where three or more road ends meet. */
  isJunction(nodeId) {
    const stamp = this.world.revision;
    if (this._junctionStamp !== stamp) {
      this._junctionIds = new Set();
      for (const node of this.world.data.nodes || []) {
        if ((this.world.roadsAtNode(node.id) || []).length > 2) this._junctionIds.add(node.id);
      }
      this._junctionStamp = stamp;
    }
    return this._junctionIds.has(nodeId);
  }

  /** Whoever is standing in the box right now, if anybody. */
  boxOccupied(node, agent, radius) {
    for (const other of this.agents.values()) {
      if (other === agent || !other.lane) continue;
      const nose = Math.hypot(
        other.x + Math.cos(other.yaw) * other.length - node.x,
        other.y + Math.sin(other.yaw) * other.length - node.y
      );
      if (nose < radius) return other;
    }
    return null;
  }

  /**
   * Where to hold on the approach. A light has to be waited at outside the
   * junction box, or a car stopped on the line would be sitting in the middle
   * of it where committed traffic has every reason to drive straight past.
   */
  stopS(agent) {
    const node = this.world.nodeById(agent.lane.to);
    const setback = STOP_SETBACK + (node && this.isJunction(node.id) ? this.junctionRadius(node) + agent.length * 0.5 : 0);
    return Math.min(setback, agent.lane.length * 0.4);
  }

  /** Half-width of the roads meeting at a node, plus a little slack. */
  junctionRadius(node) {
    const stamp = this.world.revision;
    if (this._radiusStamp !== stamp) {
      this.radii.clear();
      this._radiusStamp = stamp;
    }
    if (this.radii.has(node.id)) return this.radii.get(node.id);
    let r = 4;
    for (const road of this.world.roadsAtNode(node.id) || []) {
      const lanes = (road.lanesF ?? 1) + (road.oneway ? 0 : (road.lanesB ?? 1));
      r = Math.max(r, (lanes * (road.laneWidth ?? 3.5)) / 2);
    }
    this.radii.set(node.id, r);
    return r;
  }

  unstick(agent, target) {
    if (target > 0 || !agent.leader || agent.speed > 0.4) return target;
    if (agent.signal && agent.signal !== 'green') return target;
    const stuckFor = this.time - (agent.leader.stuckAt ?? this.time);
    if (stuckFor < DEADLOCK_ESCAPE) return target;
    const clearance = Math.hypot(agent.leader.x - agent.x, agent.leader.y - agent.y) - (agent.length + agent.leader.length) / 2;
    return clearance > CREEP_CLEARANCE ? CREEP_SPEED : target;
  }

  /**
   * Where the body sits on the planned route: distance along it, sideways
   * error and the direction of the road there. This is the reference the
   * controller works from, so the plan stays pure lane geometry and the car is
   * measured against it rather than the other way round.
   */
  track(agent) {
    const plan = agent.plan;
    const pts = plan.pts;
    let bestD = Infinity;
    let bestI = 1;
    let bestT = 0;
    for (let i = 1; i < pts.length; i++) {
      const r = distToSeg(agent.x, agent.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      if (r.d < bestD) {
        bestD = r.d;
        bestI = i;
        bestT = r.t;
      }
    }
    const a = pts[bestI - 1];
    const b = pts[bestI];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len;
    const dirY = dy / len;
    const rx = agent.x - (a.x + dx * bestT);
    const ry = agent.y - (a.y + dy * bestT);
    agent.trackIndex = bestI;
    agent.arc = a.s + bestT * len;
    agent.offset = rx * -dirY + ry * dirX;
    agent.roadHeading = Math.atan2(dirY, dirX);
  }

  /**
   * Steer towards a point up the road, with a sideways-error term to haul the
   * body back onto the line. Pure pursuit alone leaves a standing error on
   * junctions and slowly wanders off the carriageway.
   */
  steerFor(agent) {
    const plan = agent.plan;
    // The further off the road a body is, the further down the route the aim
    // point goes. A near aim point turns into a circle around it once the body
    // is abeam; a distant one keeps steering the body back onto the road.
    const look = clamp(agent.speed * 0.9 + 6 + Math.abs(agent.offset) * 2, LOOKAHEAD_MIN, LOOKAHEAD_MAX);
    // Keep pushing the aim point down the route until it is far enough away in
    // world space. Near the end of a lane the arc distance alone can leave the
    // point level with the body, and chasing something abeam just spins the car
   // round and round it.
    let arc = agent.arc + look;
    let aim = this.planPoint(plan, arc);
    while (arc < plan.total && Math.hypot(aim.x - agent.x, aim.y - agent.y) < MIN_AIM) {
      arc += 2;
      aim = this.planPoint(plan, arc);
    }
    agent.aim = aim;
    agent.aimDist = Math.hypot(aim.x - agent.x, aim.y - agent.y);
    const alpha = wrapAngle(Math.atan2(aim.y - agent.y, aim.x - agent.x) - agent.yaw);
    agent.alpha = alpha;
    const pursuit = clamp(
      Math.atan2(2 * agent.wheelbase * Math.sin(alpha), Math.max(1, look)),
      -agent.maxSteer * 0.75,
      agent.maxSteer * 0.75,
    );
    const cross = clamp(
      -Math.atan2(CROSS_K * agent.offset, Math.max(2.5, agent.speed + CROSS_SOFT)),
      -agent.maxSteer * 0.5,
      agent.maxSteer * 0.5,
    );
    return clamp(pursuit + cross, -agent.maxSteer, agent.maxSteer);
  }

  brakingDistance(agent) {
    return (agent.speed * agent.speed) / (2 * Math.max(0.5, agent.brake * 0.6));
  }

  /** Hold a safe gap to whatever is driving in front of us. */
  leaderTarget(agent) {
    let target = Infinity;
    let overlap = Infinity;
    const cos = Math.cos(agent.yaw);
    const sin = Math.sin(agent.yaw);
    for (const other of this.agents.values()) {
      if (other === agent || !other.lane) continue;
      const dx = other.x - agent.x;
      const dy = other.y - agent.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3 || d > LEADER_RANGE) continue;
      const forward = dx * cos + dy * sin;
      if (forward <= 0.5) continue;
      if (Math.abs(wrapAngle(Math.atan2(dy, dx) - agent.yaw)) > LEADER_CONE) continue;
      // Traffic going our way blocks us; crossing traffic in a junction does not,
      // otherwise two cars meeting at a crossing wait for each other for ever.
      if (Math.abs(wrapAngle(other.yaw - agent.yaw)) > SAME_DIRECTION) continue;
      const gap = d - (agent.length + other.length) / 2 - MIN_GAP;
      if (gap <= 0) {
        if (d < overlap) {
          overlap = d;
          agent.leader = other;
        }
        target = 0;
        continue;
      }
      const comfortable = Math.sqrt(2 * agent.brake * 0.7 * gap);
      const matching = other.speed + gap * 0.35;
      if (matching < target) agent.leader = other;
      target = Math.min(target, comfortable, matching);
    }
    return target;
  }

  /** Stop for trees, poles, parked cars and walls standing in the corridor. */
  obstacleTarget(agent) {
    const reach = 32;
    const half = reach / 2;
    const ids = this.world.queryIds({ minX: agent.x - half, minY: agent.y - half, maxX: agent.x + half, maxY: agent.y + half });
    if (!ids.size) return Infinity;
    const cos = Math.cos(agent.yaw);
    const sin = Math.sin(agent.yaw);
    let target = Infinity;
    for (const id of ids) {
      const found = this.world.findEntity(id);
      if (!found) continue;
      let ox = null;
      let oy = null;
      let radius = 0;
      if (found.type === 'props') {
        const preset = PROP_KINDS[found.object.kind];
        if (!preset || !preset.blocking) continue;
        radius = Math.max(0.3, (preset.radius || 1) * (found.object.scale || 1));
        ox = found.object.x;
        oy = found.object.y;
      } else if (found.type === 'buildings') {
        const edge = distToPolyEdge(agent.x, agent.y, found.object.poly);
        const clearance = agent.width / 2 + 0.3;
        if (edge > clearance) continue;
        radius = clearance;
        ox = found.object.poly[0].x;
        oy = found.object.poly[0].y;
      } else {
        continue;
      }
      const dx = ox - agent.x;
      const dy = oy - agent.y;
      const forward = dx * cos + dy * sin;
      const lateral = Math.abs(-dx * sin + dy * cos);
      if (forward <= 0.2 || forward > reach) continue;
      if (lateral > radius + agent.width / 2 + 0.4) continue;
      const gap = forward - radius - agent.length / 2;
      if (gap <= 0) {
        agent.blocked = found.object;
        return 0;
      }
      if (forward < reach) agent.blocked = agent.blocked || found.object;
      target = Math.min(target, Math.sqrt(2 * agent.brake * 0.7 * gap));
    }
    return target;
  }

  /* ------------------------------------------------------------ lifecycle */

  spawn(vehicle) {
    const agent = {
      id: vehicle.id,
      recent: [],
      laneId: null,
      lane: null,
      s: 0,
      plan: null,
      arc: 0,
      turn: null,
      signal: null,
      leader: null,
      blocked: null,
      reason: '',
      state: DRIVE_STATE.offroad,
      speed: 0,
      distance: 0,
      steer: 0,
      offset: 0,
      targetSpeed: 0,
      stuckAt: null,
    };
    this.readSpec(agent, vehicle);
    this.place(agent, vehicle.x, vehicle.y, vehicle.yaw);
    return agent;
  }

  readSpec(agent, vehicle) {
    agent.kind = vehicle.kind;
    agent.color = vehicle.color;
    agent.wheelbase = Math.max(0.8, vehicle.wheelbase || 2.7);
    agent.length = Math.max(1, vehicle.length || 4.6);
    agent.width = Math.max(1, vehicle.width || 1.85);
    agent.height = vehicle.height || 1.48;
    agent.maxSteer = Math.max(0.05, vehicle.maxSteer || 0.6);
    agent.maxSpeed = Math.max(5, vehicle.maxSpeed || 50);
    agent.accel = Math.max(0.2, vehicle.accel || 2.5);
    agent.brake = Math.max(0.5, vehicle.brake || 8);
    agent.drag = Math.max(0, vehicle.drag ?? 0.4);
  }

  /** Drop an agent onto the network at a world position, or leave it parked. */
  place(agent, x, y, yaw = 0) {
    const hit = this.laneUnder(x, y);
    agent.x = x;
    agent.y = y;
    agent.yaw = yaw;
    agent.speed = 0;
    agent.plan = null;
    agent.recent.length = 0;
    if (!hit) {
      agent.laneId = null;
      agent.lane = null;
      agent.s = 0;
      agent.state = DRIVE_STATE.offroad;
      agent.reason = 'no lane here';
      return null;
    }
    agent.laneId = hit.laneId;
    agent.lane = hit.lane;
    agent.s = hit.s;
    agent.yaw = hit.heading;
    agent.state = this.running ? DRIVE_STATE.driving : DRIVE_STATE.parked;
    agent.reason = '';
    this.remember(agent, hit.laneId);
    return hit;
  }

  /** Nearest lane under a point, or null when the point is nowhere near one. */
  laneUnder(x, y) {
    this.network.ensure();
    const near = this.network.laneByPoint(x, y, null);
    if (near) return near;
    const loose = this.network.nearestLane(x, y);
    return loose && loose.distance <= SNAP_RANGE ? loose : null;
  }

  stats() {
    let distance = 0;
    let driving = 0;
    let speed = 0;
    for (const agent of this.agents.values()) {
      distance += agent.distance;
      speed += agent.speed;
      if (agent.state === DRIVE_STATE.driving) driving += 1;
    }
    const n = this.agents.size;
    return {
      running: this.running,
      vehicles: n,
      driving,
      distance,
      avgSpeed: n ? speed / n : 0,
      time: this.time,
    };
  }

  /** Compact per-vehicle telemetry, handy for tests and exports. */
  report() {
    return this.list().map((a) => ({
      id: a.id,
      kind: a.kind,
      x: +a.x.toFixed(2),
      y: +a.y.toFixed(2),
      yaw: +a.yaw.toFixed(3),
      speed_mps: +a.speed.toFixed(2),
      speed_kph: +((a.speed * 3.6)).toFixed(1),
      lane: a.laneId,
      s: +a.s.toFixed(1),
      turn: a.turn,
      state: a.state,
      reason: a.reason,
      distance_m: +a.distance.toFixed(1),
    }));
  }
}

const TURN_COST = {
  through: 0,
  slight_right: 0.5,
  slight_left: 0.5,
  right: 1.2,
  left: 1.2,
  sharp_right: 3,
  sharp_left: 3,
  uturn: 12,
};
const DEAD_END_COST = 14;