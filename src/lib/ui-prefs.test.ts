import { describe, it, expect } from "vitest";
import {
  MAIL_DETAIL_MIN, MAIL_LIST_MAX, MAIL_LIST_MIN, clampListWidth, listWidthForKey, mergeUiPrefs, normalizeUiPrefs, parseUiPrefsCache,
  sanitizeUiPref, uiPrefsStorageKey,
} from "./ui-prefs";

describe("předvolby vzhledu (Pošta: šířka seznamu, sbalené složky)", () => {
  it("ověření: jen známé klíče a správný typ, šířka do rozsahu, null = výchozí", () => {
    expect(sanitizeUiPref("mail.listWidth", 420.6)).toEqual({ ok: true, key: "mail.listWidth", value: 421 });
    expect(sanitizeUiPref("mail.listWidth", 10)).toEqual({ ok: true, key: "mail.listWidth", value: MAIL_LIST_MIN });
    expect(sanitizeUiPref("mail.listWidth", 99999)).toEqual({ ok: true, key: "mail.listWidth", value: MAIL_LIST_MAX });
    expect(sanitizeUiPref("mail.listWidth", "abc").ok).toBe(false);
    expect(sanitizeUiPref("mail.foldersCollapsed", true)).toEqual({ ok: true, key: "mail.foldersCollapsed", value: true });
    expect(sanitizeUiPref("mail.foldersCollapsed", "ano").ok).toBe(false);
    expect(sanitizeUiPref("mail.listWidth", null)).toEqual({ ok: true, key: "mail.listWidth", value: null });
    expect(sanitizeUiPref("role", "super_admin").ok).toBe(false);
  });

  it("normalizace z DB zahodí neznámé a vadné", () => {
    expect(normalizeUiPrefs({ "mail.listWidth": 300, "mail.foldersCollapsed": "x", hack: 1 })).toEqual({ "mail.listWidth": 300 });
    expect(normalizeUiPrefs(null)).toEqual({});
    expect(normalizeUiPrefs([1, 2])).toEqual({});
  });

  it("skutečná šířka: výchozí 30 %, min seznamu 260, detail min 480 — na úzké obrazovce vyhraje minimum seznamu", () => {
    expect(clampListWidth(undefined, 1400)).toBe(420);
    expect(clampListWidth(undefined, 700)).toBe(MAIL_LIST_MIN);
    expect(clampListWidth(900, 1400)).toBe(900);
    expect(clampListWidth(1000, 1400)).toBe(1400 - MAIL_DETAIL_MIN);
    expect(clampListWidth(100, 1400)).toBe(MAIL_LIST_MIN);
    expect(clampListWidth(500, 600)).toBe(MAIL_LIST_MIN);
  });

  it("klávesnice: šipky ±16 (Shift ±64), Home/End, jiné klávesy nic", () => {
    expect(listWidthForKey("ArrowRight", false, 400, 1400)).toBe(416);
    expect(listWidthForKey("ArrowLeft", true, 400, 1400)).toBe(336);
    expect(listWidthForKey("ArrowLeft", false, 265, 1400)).toBe(MAIL_LIST_MIN);
    expect(listWidthForKey("ArrowRight", true, 900, 1400)).toBe(920);
    expect(listWidthForKey("Home", false, 500, 1400)).toBe(MAIL_LIST_MIN);
    expect(listWidthForKey("End", false, 500, 1400)).toBe(920);
    expect(listWidthForKey("a", false, 500, 1400)).toBeNull();
  });

  it("mezipaměť prohlížeče: nepotvrzené změny mají přednost před DB, potvrzené ne (změna z jiného prohlížeče)", () => {
    const cache = parseUiPrefsCache(JSON.stringify({ prefs: { "mail.listWidth": 350, "mail.foldersCollapsed": true }, pending: ["mail.listWidth", "bad"] }));
    expect(cache.pending).toEqual(["mail.listWidth"]);
    expect(mergeUiPrefs({ "mail.listWidth": 500, "mail.foldersCollapsed": false }, cache)).toEqual({ "mail.listWidth": 350, "mail.foldersCollapsed": false });
    // smazaná (výchozí) předvolba čekající na zápis
    const reset = parseUiPrefsCache(JSON.stringify({ prefs: {}, pending: ["mail.listWidth"] }));
    expect(mergeUiPrefs({ "mail.listWidth": 500 }, reset)).toEqual({});
    expect(parseUiPrefsCache("{rozbité")).toEqual({ prefs: {}, pending: [] });
    expect(uiPrefsStorageKey("u1")).not.toBe(uiPrefsStorageKey("u2"));
  });
});
