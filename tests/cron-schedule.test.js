import test from "node:test";
import assert from "node:assert/strict";
import { cronMatches, isValidCronExpression, parseCronExpression } from "../26.00.00/theme/AppName_Basic/User/js/cron-schedule.js";

test("parses and matches a weekday UTC schedule", () => {
  assert.equal(cronMatches("0 9 * * 1-5", new Date("2026-10-26T09:00:00.000Z")), true);
  assert.equal(cronMatches("0 9 * * 1-5", new Date("2026-10-25T09:00:00.000Z")), false);
  assert.equal(cronMatches("0 9 * * 1-5", new Date("2026-10-26T09:01:00.000Z")), false);
});

test("supports steps, ranges and lists", () => {
  assert.equal(cronMatches("*/15 8-10 * * 1,3,5", new Date("2026-10-26T08:30:00.000Z")), true);
  assert.equal(cronMatches("*/15 8-10 * * 1,3,5", new Date("2026-10-26T08:31:00.000Z")), false);
});

test("normalizes weekday seven to Sunday zero", () => {
  assert.equal(cronMatches("30 12 * * 7", new Date("2026-10-25T12:30:00.000Z")), true);
  assert.equal(cronMatches("30 12 * * 0", new Date("2026-10-25T12:30:00.000Z")), true);
});

test("uses standard OR behaviour when both day-of-month and weekday are restricted", () => {
  const expression = "0 0 1 * 1";
  assert.equal(cronMatches(expression, new Date("2026-11-01T00:00:00.000Z")), true);
  assert.equal(cronMatches(expression, new Date("2026-11-02T00:00:00.000Z")), true);
  assert.equal(cronMatches(expression, new Date("2026-11-03T00:00:00.000Z")), false);
});

test("rejects invalid field counts, steps and ranges", () => {
  for (const cron of ["", "* * * *", "* * * * * *", "*/0 * * * *", "61 * * * *", "5-2 * * * *", "x 9 * * 1"]) {
    assert.equal(isValidCronExpression(cron), false, cron);
    assert.throws(() => parseCronExpression(cron));
  }
});

test("cron matching rejects invalid dates", () => {
  assert.throws(() => cronMatches("* * * * *", new Date("invalid")), /valid Date/);
});
