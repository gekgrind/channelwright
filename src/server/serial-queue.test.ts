import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serial-queue";

describe("serial queue", () => {
  it("runs queued operations one at a time in submission order", async () => {
    const exclusive = createSerialQueue();
    const order: string[] = [];
    const operation = (name: string, delay: number) => exclusive(async () => {
      order.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      order.push(`${name}:end`);
      return name;
    });
    const results = await Promise.all([operation("first", 20), operation("second", 1)]);
    expect(results).toEqual(["first", "second"]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("keeps serializing after a rejected operation", async () => {
    const exclusive = createSerialQueue();
    await expect(exclusive(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    await expect(exclusive(async () => "next")).resolves.toBe("next");
  });
});
