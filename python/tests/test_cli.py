import json

from thanos.cli import main


def _write_messages(tmp_path, messages):
    path = tmp_path / "conversation.json"
    path.write_text(json.dumps(messages))
    return str(path)


def test_check_prints_report_and_returns_zero_when_under_limit(tmp_path, capsys):
    path = _write_messages(tmp_path, [{"role": "user", "content": "hello"}])

    code = main(["check", path, "--model", "claude-haiku-4-5"])

    out = capsys.readouterr().out
    assert code == 0
    assert "model:" in out
    assert "claude-haiku-4-5" in out
    assert "limit exceeded:  False" in out


def test_check_json_output_is_valid_json(tmp_path, capsys):
    path = _write_messages(tmp_path, [{"role": "user", "content": "hello"}])

    code = main(["check", path, "--model", "claude-haiku-4-5", "--json"])

    out = capsys.readouterr().out
    report = json.loads(out)
    assert code == 0
    assert report["model"] == "claude-haiku-4-5"
    assert report["limit_exceeded"] is False


def test_check_returns_nonzero_when_budget_exceeded(tmp_path, capsys):
    path = _write_messages(tmp_path, [{"role": "user", "content": "x" * 4000}])

    code = main(
        ["check", path, "--model", "claude-haiku-4-5", "--max-tokens", "10", "--json"]
    )

    report = json.loads(capsys.readouterr().out)
    assert code == 1
    assert report["limit_exceeded"] is True


def test_check_accepts_object_with_messages_key(tmp_path, capsys):
    path = tmp_path / "conversation.json"
    path.write_text(json.dumps({"messages": [{"role": "user", "content": "hi"}]}))

    code = main(["check", str(path), "--model", "claude-haiku-4-5"])

    assert code == 0


def test_models_lists_bundled_registry(capsys):
    code = main(["models"])

    out = capsys.readouterr().out
    assert code == 0
    assert "claude-sonnet-4-5" in out
    assert "gpt-5" in out


def test_models_json_output(capsys):
    code = main(["models", "--json"])

    registry = json.loads(capsys.readouterr().out)
    assert code == 0
    assert registry["claude-sonnet-4-5"]["provider"] == "anthropic"
