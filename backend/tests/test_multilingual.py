from app.main import _analysis_language_instruction


def test_analysis_prompt_preserves_spanish() -> None:
    instruction = _analysis_language_instruction("spanish")
    assert "spanish" in instruction
    assert "Do not translate" in instruction


def test_analysis_prompt_preserves_french() -> None:
    assert "french" in _analysis_language_instruction("french")


def test_analysis_prompt_preserves_other_non_english_language() -> None:
    assert "japanese" in _analysis_language_instruction("japanese")
