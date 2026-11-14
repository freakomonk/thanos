import pytest

from thanos import anthropic_count_tokens_tokenizer, tiktoken_tokenizer


def _msg(role: str, content) -> dict:
    return {"role": role, "content": content}


def test_tiktoken_tokenizer_counts_real_subword_tokens():
    pytest.importorskip("tiktoken")

    tokenizer = tiktoken_tokenizer(model="gpt-5")
    messages = [_msg("user", "supercalifragilisticexpialidocious")]

    tokens = tokenizer(messages)

    assert tokens > 4  # a real tokenizer splits this into several subword pieces


def test_tiktoken_tokenizer_falls_back_to_o200k_base_for_unknown_model():
    pytest.importorskip("tiktoken")

    tokenizer = tiktoken_tokenizer(
        model="some-brand-new-model-tiktoken-has-never-heard-of"
    )

    assert tokenizer([_msg("user", "hello world")]) > 0


def test_tiktoken_tokenizer_raises_a_clear_error_when_tiktoken_is_missing(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "tiktoken":
            raise ImportError("No module named 'tiktoken'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    with pytest.raises(ImportError, match="pip install tiktoken"):
        tiktoken_tokenizer()


class _FakeCountTokensResponse:
    def __init__(self, input_tokens: int):
        self.input_tokens = input_tokens


class _FakeAnthropicMessages:
    def __init__(self):
        self.last_call: dict = {}

    def count_tokens(self, **kwargs):
        self.last_call = kwargs
        return _FakeCountTokensResponse(input_tokens=42)


class _FakeAnthropicClient:
    def __init__(self):
        self.messages = _FakeAnthropicMessages()


def test_anthropic_count_tokens_tokenizer_calls_the_client():
    client = _FakeAnthropicClient()
    tokenizer = anthropic_count_tokens_tokenizer(client, model="claude-sonnet-4-5")

    tokens = tokenizer([_msg("user", "hi")])

    assert tokens == 42
    assert client.messages.last_call["model"] == "claude-sonnet-4-5"
    assert client.messages.last_call["messages"] == [_msg("user", "hi")]
    assert "system" not in client.messages.last_call


def test_anthropic_count_tokens_tokenizer_splits_out_the_system_message():
    client = _FakeAnthropicClient()
    tokenizer = anthropic_count_tokens_tokenizer(client, model="claude-sonnet-4-5")
    messages = [_msg("system", "You are helpful."), _msg("user", "hi")]

    tokenizer(messages)

    assert client.messages.last_call["system"] == "You are helpful."
    assert client.messages.last_call["messages"] == [_msg("user", "hi")]
