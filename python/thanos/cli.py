from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .budget import Budget
from .guard import ContextGuard
from .pricing import load_models

Message = dict[str, Any]


def _read_messages(path: str) -> list[Message]:
    if path == "-":
        text = sys.stdin.read()
    else:
        with open(path) as f:
            text = f.read()
    payload = json.loads(text)
    if isinstance(payload, dict) and "messages" in payload:
        payload = payload["messages"]
    if not isinstance(payload, list):
        raise SystemExit(
            'Input must be a JSON array of messages, or an object with a "messages" array.'
        )
    return payload


def _stay_in_tier(value: str) -> int | None:
    return None if value.lower() == "none" else int(value)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="thanos",
        description="Context-window limits, pricing tiers, and compression for LLM conversations.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser(
        "check",
        help="Report tokens, pricing tier, and estimated cost for a conversation, "
        "and what prepare() would do to it.",
    )
    check.add_argument(
        "file", help="Path to a JSON file with a messages array (or '-' for stdin)."
    )
    check.add_argument(
        "--model",
        required=True,
        help="Model id, e.g. claude-sonnet-4-5. See `thanos models`.",
    )
    check.add_argument("--pinned-prefix-len", type=int, default=1)
    check.add_argument(
        "--stay-in-tier",
        default="0",
        help="Tier index to cap at (default 0, the cheapest tier), or 'none' to only cap at the context window.",
    )
    check.add_argument(
        "--output-tokens",
        type=int,
        default=0,
        help="Estimated output tokens, for cost estimation.",
    )
    check.add_argument("--cache-write-tokens", type=int, default=0)
    check.add_argument("--cache-read-tokens", type=int, default=0)
    check.add_argument(
        "--max-tokens",
        type=int,
        default=None,
        help="Optional budget ceiling in tokens.",
    )
    check.add_argument(
        "--max-cost-usd",
        type=float,
        default=None,
        help="Optional budget ceiling in dollars.",
    )
    check.add_argument(
        "--json", action="store_true", help="Print a machine-readable JSON report."
    )

    models = sub.add_parser("models", help="List models in the bundled registry.")
    models.add_argument("--json", action="store_true")

    return parser


def _cmd_check(args: argparse.Namespace) -> int:
    messages = _read_messages(args.file)
    budget = None
    if args.max_tokens is not None or args.max_cost_usd is not None:
        budget = Budget(max_tokens=args.max_tokens, max_cost_usd=args.max_cost_usd)

    guard = ContextGuard(
        model=args.model,
        budget=budget,
        pinned_prefix_len=args.pinned_prefix_len,
        stay_in_tier=_stay_in_tier(args.stay_in_tier),
    )
    result = guard.prepare(
        messages,
        estimated_output_tokens=args.output_tokens,
        cache_write_tokens=args.cache_write_tokens,
        cache_read_tokens=args.cache_read_tokens,
        record=False,
    )

    report = {
        "model": args.model,
        "input_messages": len(messages),
        "output_messages": len(result.messages),
        "tokens": result.tokens,
        "tier_max_tokens": result.tier_max_tokens,
        "estimated_cost_usd": round(result.estimated_cost_usd, 6),
        "compressed": result.compressed,
        "limit_exceeded": result.limit_exceeded,
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        suffix = " (compressed)" if report["compressed"] else ""
        print(f"model:           {report['model']}")
        print(
            f"messages:        {report['input_messages']} -> {report['output_messages']}{suffix}"
        )
        print(
            f"tokens:          {report['tokens']} (tier ceiling {report['tier_max_tokens']})"
        )
        print(f"estimated cost:  ${report['estimated_cost_usd']:.6f}")
        print(f"limit exceeded:  {report['limit_exceeded']}")

    return 1 if report["limit_exceeded"] else 0


def _cmd_models(args: argparse.Namespace) -> int:
    models = load_models()
    if args.json:
        out = {
            mid: {"provider": m.provider, "contextWindow": m.context_window}
            for mid, m in sorted(models.items())
        }
        print(json.dumps(out, indent=2))
    else:
        for mid, m in sorted(models.items()):
            print(
                f"{mid:<22} provider={m.provider or '-':<10} contextWindow={m.context_window}"
            )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "check":
        return _cmd_check(args)
    if args.command == "models":
        return _cmd_models(args)
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
