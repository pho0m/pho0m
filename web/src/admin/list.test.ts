import { describe, expect, it } from "vitest";
import { dateOrder, insertItem, moveItem, removeItem, replaceItem, syncKeys } from "./list.ts";

describe("moveItem", () => {
  it("moves down and up without mutating the input", () => {
    const a = ["a", "b", "c", "d"];
    expect(moveItem(a, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(a, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(a).toEqual(["a", "b", "c", "d"]);
  });
  it("clamps the target and ignores bad sources", () => {
    expect(moveItem(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 1, -5)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveItem([], 0, 1)).toEqual([]);
  });
  it("returns a copy when nothing moves", () => {
    const a = [1, 2];
    const out = moveItem(a, 1, 1);
    expect(out).toEqual([1, 2]);
    expect(out).not.toBe(a);
  });
});

describe("insertItem / removeItem / replaceItem", () => {
  it("inserts at the clamped index", () => {
    expect(insertItem([1, 2, 3], 1, 9)).toEqual([1, 9, 2, 3]);
    expect(insertItem([1, 2], 10, 9)).toEqual([1, 2, 9]);
    expect(insertItem([1, 2], -3, 9)).toEqual([9, 1, 2]);
    expect(insertItem([], 0, "x")).toEqual(["x"]);
  });
  it("removes and replaces only valid indexes", () => {
    expect(removeItem([1, 2, 3], 1)).toEqual([1, 3]);
    expect(removeItem([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(replaceItem([1, 2, 3], 2, 7)).toEqual([1, 2, 7]);
    expect(replaceItem([1, 2, 3], -1, 7)).toEqual([1, 2, 3]);
  });
});

describe("syncKeys", () => {
  it("keeps, appends and trims keys", () => {
    let n = 100;
    const next = () => n++;
    expect(syncKeys([1, 2], 2, next)).toEqual([1, 2]);
    expect(syncKeys([1, 2], 4, next)).toEqual([1, 2, 100, 101]);
    expect(syncKeys([1, 2, 3], 1, next)).toEqual([1]);
  });
});

describe("dateOrder", () => {
  it("sorts by date and keeps the original order for equal dates", () => {
    const frames = [{ date: "2023-05" }, { date: "2020" }, { date: "2023-05" }, { date: "2022" }, { date: "2022-03" }];
    expect(dateOrder(frames)).toEqual([1, 3, 4, 0, 2]);
  });
});
