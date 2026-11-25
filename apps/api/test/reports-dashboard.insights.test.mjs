import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboardInsights, insightThresholds, percentage } from '../dist/reports/reports-dashboard.insights.js';

const base = () => ({
  appointmentStatus: { total: 40, attended: 30, noShows: 1, cancelled: 2 },
  rates: { noShowRatePct: percentage(1, 31), cancellationRatePct: percentage(2, 40), occupancyPct: 60 },
  slots: { released: 2, recovered: 2, recoveryRatePct: 100 },
  offers: { sent: 4, expired: 0 },
  capacity: { total: 60 },
  services: [{ name: 'Kinesiología', attended: 30, noShows: 1, noShowRatePct: percentage(1, 31), waiting: 0 }],
  waitlist: { active: 0 },
});
const codes = (input) => dashboardInsights(input).map((insight) => insight.code);

test('percentage rounds to two decimals and never divides by zero', () => {
  assert.equal(percentage(1, 3), 33.33);
  assert.equal(percentage(5, 0), 0);
  assert.equal(percentage(0, 7), 0);
});
test('stable operation produces a single informative insight', () => {
  const insights = dashboardInsights(base());
  assert.deepEqual(insights.map(({ code, severity }) => ({ code, severity })), [{ code: 'STABLE', severity: 'info' }]);
});
test('no activity is reported instead of a stable state', () => {
  const empty = { ...base(), appointmentStatus: { total: 0, attended: 0, noShows: 0, cancelled: 0 },
    rates: { noShowRatePct: 0, cancellationRatePct: 0, occupancyPct: 0 }, slots: { released: 0, recovered: 0, recoveryRatePct: 0 },
    offers: { sent: 0, expired: 0 }, capacity: { total: 0 }, services: [], waitlist: { active: 0 } };
  assert.deepEqual(codes(empty), ['NO_ACTIVITY']);
});
test('no-show severity follows medium and high thresholds and requires a minimum sample', () => {
  const medium = base(); medium.appointmentStatus = { total: 40, attended: 27, noShows: 3, cancelled: 2 };
  medium.rates.noShowRatePct = percentage(3, 30);
  assert.equal(dashboardInsights(medium).find((i) => i.code === 'NO_SHOW_RATE').severity, 'medium');
  const high = base(); high.appointmentStatus = { total: 40, attended: 24, noShows: 6, cancelled: 2 };
  high.rates.noShowRatePct = percentage(6, 30);
  const insight = dashboardInsights(high).find((i) => i.code === 'NO_SHOW_RATE');
  assert.equal(insight.severity, 'high'); assert.match(insight.detail, /6 de 30 citas cerradas/);
  const small = base(); small.appointmentStatus = { total: 9, attended: 5, noShows: 4, cancelled: 0 };
  small.rates.noShowRatePct = percentage(4, 9);
  assert.ok(!codes(small).includes('NO_SHOW_RATE'));
});
test('service hotspot picks the highest no-show rate with enough closed appointments', () => {
  const input = base();
  input.services = [
    { name: 'Dental', attended: 4, noShows: 4, noShowRatePct: 50, waiting: 0 },
    { name: 'Psicología', attended: 8, noShows: 2, noShowRatePct: 20, waiting: 0 },
    { name: 'Nutrición', attended: 2, noShows: 2, noShowRatePct: 50, waiting: 0 },
  ];
  const hotspot = dashboardInsights(input).find((i) => i.code === 'NO_SHOW_SERVICE');
  assert.match(hotspot.title, /^Dental/);
  input.services[0].attended = 0; input.services[0].noShows = 4;
  assert.match(dashboardInsights(input).find((i) => i.code === 'NO_SHOW_SERVICE').title, /^Psicología/);
});
test('cancellation, recovery and expiring offers produce actionable alerts', () => {
  const input = base();
  input.appointmentStatus.cancelled = 12; input.rates.cancellationRatePct = percentage(12, 40);
  input.slots = { released: 6, recovered: 1, recoveryRatePct: percentage(1, 6) };
  input.offers = { sent: 10, expired: 5 };
  const insights = dashboardInsights(input);
  assert.deepEqual(insights.map((i) => i.code), ['CANCELLATION_RATE', 'LOW_RECOVERY', 'OFFERS_EXPIRING']);
  assert.equal(insights[0].severity, 'high');
  for (const insight of insights) assert.ok(insight.action.length > 20);
});
test('high occupancy with waiting people is the top alert and names the service with most demand', () => {
  const input = base();
  input.rates.occupancyPct = 92; input.waitlist.active = 9;
  input.services = [{ name: 'Dental', attended: 1, noShows: 0, noShowRatePct: 0, waiting: 2 },
    { name: 'Kinesiología', attended: 1, noShows: 0, noShowRatePct: 0, waiting: 7 }];
  const [first] = dashboardInsights(input);
  assert.equal(first.code, 'DEMAND_OVER_CAPACITY'); assert.equal(first.severity, 'high');
  assert.match(first.action, /Kinesiología, que tiene 7 personas/);
  assert.ok(!codes(input).includes('WAITLIST_FOCUS'));
});
test('waitlist focus is informative when capacity is not saturated; low occupancy needs enough slots', () => {
  const input = base(); input.waitlist.active = 3; input.services[0].waiting = 3;
  assert.deepEqual(codes(input), ['WAITLIST_FOCUS']);
  const idle = base(); idle.rates.occupancyPct = 20;
  assert.deepEqual(codes(idle), ['LOW_OCCUPANCY']);
  idle.capacity.total = insightThresholds.minimumCapacity - 1;
  assert.deepEqual(codes(idle), ['STABLE']);
});
test('insights are sorted by severity and thresholds are frozen', () => {
  const input = base();
  input.rates.occupancyPct = 95; input.waitlist.active = 1; input.services[0].waiting = 1;
  input.slots = { released: 4, recovered: 0, recoveryRatePct: 0 };
  assert.deepEqual(dashboardInsights(input).map((i) => i.severity), ['high', 'medium']);
  assert.ok(Object.isFrozen(insightThresholds));
});
