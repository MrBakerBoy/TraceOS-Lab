"""Tests for prompt_builder module."""

from app.services.prompt_builder import (
    build_diagnosis_prompt,
    build_hints_prompt,
    CATEGORY_PROMPTS,
)


def test_build_returns_tuple_of_strings() -> None:
    system, user = build_diagnosis_prompt(
        code="int main(){}",
        experiment_title="Test",
        experiment_description="Desc",
        language="c",
    )
    assert isinstance(system, str)
    assert isinstance(user, str)
    assert len(system) > 0
    assert len(user) > 0


def test_user_prompt_contains_code() -> None:
    code = 'int main() { printf("hello"); return 0; }'
    _, user = build_diagnosis_prompt(
        code=code,
        experiment_title="Test",
        experiment_description="Desc",
        language="c",
    )
    assert code in user


def test_user_prompt_contains_compile_error() -> None:
    _, user = build_diagnosis_prompt(
        code="int main(){}",
        experiment_title="Test",
        experiment_description="Desc",
        language="c",
        compile_error="main.c:5: error: expected ';'",
    )
    assert "expected ';'" in user
    assert "编译错误" in user


def test_user_prompt_contains_strace() -> None:
    _, user = build_diagnosis_prompt(
        code="int main(){}",
        experiment_title="Test",
        experiment_description="Desc",
        language="c",
        strace_summary="openat() = -1 ENOENT",
    )
    assert "openat" in user
    assert "系统调用摘要" in user


def test_system_prompt_varies_by_category() -> None:
    system_process, _ = build_diagnosis_prompt(
        code="x", experiment_title="T", experiment_description="D",
        language="c", experiment_category="process",
    )
    system_thread, _ = build_diagnosis_prompt(
        code="x", experiment_title="T", experiment_description="D",
        language="c", experiment_category="thread",
    )
    assert "fork" in system_process
    assert "死锁" in system_thread
    assert system_process != system_thread


def test_user_prompt_contains_test_results() -> None:
    test_results = [
        {"name": "tc1", "passed": True},
        {"name": "tc2", "passed": False},
    ]
    _, user = build_diagnosis_prompt(
        code="x", experiment_title="T", experiment_description="D",
        language="c", test_results=test_results,
    )
    assert "tc1" in user
    assert "tc2" in user


def test_build_hints_prompt_levels_differ() -> None:
    diag = {"error_type": "runtime_error", "root_cause": "fork failed"}
    _, user1 = build_hints_prompt(diag, 1, "code", "c")
    _, user2 = build_hints_prompt(diag, 2, "code", "c")
    _, user3 = build_hints_prompt(diag, 3, "code", "c")
    assert "Level 1" in user1
    assert "Level 2" in user2
    assert "Level 3" in user3
    _, user4 = build_hints_prompt(diag, 4, "code", "c")
    assert "Level 4" in user4


def test_all_categories_have_prompts() -> None:
    for cat in ("process", "thread", "memory", "fs", "scheduler", "deadlock"):
        assert cat in CATEGORY_PROMPTS
        assert len(CATEGORY_PROMPTS[cat]) > 10
