import assert from "node:assert/strict";
import test from "node:test";
import {
  displayedTranscriptText,
  isEnglishLanguage,
  originalTranscriptText
} from "../components/meeting-translation-state.ts";

test("original transcript remains the default and English is opt-in", () => {
  const segment = { text: "Hola", original_text: "Hola", translated_text: "Hello" };
  assert.equal(displayedTranscriptText(segment, false), "Hola");
  assert.equal(displayedTranscriptText(segment, true), "Hello");
  assert.equal(originalTranscriptText(segment), "Hola");
});

test("English aliases do not require translation controls", () => {
  assert.equal(isEnglishLanguage("en"), true);
  assert.equal(isEnglishLanguage("English"), true);
  assert.equal(isEnglishLanguage("french"), false);
});
