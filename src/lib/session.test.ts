import { describe, it, expect } from "vitest";
import { session } from "./session";

describe("session folder", () => {
  it("getFolder returns null initially", () => {
    expect(session.getFolder()).toBeNull();
  });

  it("setFolder / getFolder round-trip", () => {
    session.setFolder("/tmp/scion-project");
    expect(session.getFolder()).toBe("/tmp/scion-project");
  });

  it("setFolder overwrites previous value", () => {
    session.setFolder("/tmp/first");
    session.setFolder("/tmp/second");
    expect(session.getFolder()).toBe("/tmp/second");
  });
});
