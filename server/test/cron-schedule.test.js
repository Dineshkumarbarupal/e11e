import test from "node:test";
import assert from "node:assert/strict";
import { cronMatches, isValidCronExpression } from "../src/cron-schedule.js";

test("server cron matcher evaluates expressions in UTC", () => {
  assert.equal(cronMatches("15 6 * * *", new Date("2026-10-28T06:15:00.000Z")), true);
  assert.equal(cronMatches("15 6 * * *", new Date("2026-10-28T07:15:00.000Z")), false);
});

test("server cron matcher supports list/range/step syntax", () => {
  assert.equal(cronMatches("0,30 9-17/2 * * 1-5", new Date("2026-10-26T13:30:00.000Z")), true);
  assert.equal(isValidCronExpression("60 * * * *"), false);
});
