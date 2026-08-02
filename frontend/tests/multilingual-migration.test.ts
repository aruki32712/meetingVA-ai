import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../scripts/supabase/migrations/0023_preserve_original_language.sql", import.meta.url),
  "utf8"
).toLowerCase();

test("multilingual migration stores original and translated content separately", () => {
  for (const column of [
    "summary_translated", "brief_translated", "translated_title",
    "translated_description", "translated_question", "translated_answer"
  ]) assert.match(sql, new RegExp(`add column if not exists ${column}`));
  assert.match(sql, /notify pgrst, 'reload schema'/);
  assert.doesNotMatch(sql, /drop column|drop table/);
});
