import argparse
import json
import os
import sys


def build_parser():
    parser = argparse.ArgumentParser(description="Run legacy Douyin keyword search.")
    parser.add_argument("--legacy-root", required=True)
    parser.add_argument("--cookie-string", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--offset", default="0")
    parser.add_argument("--count", default="25")
    parser.add_argument("--sort-type", default="0")
    parser.add_argument("--publish-time", default="0")
    parser.add_argument("--filter-duration", default="")
    parser.add_argument("--search-range", default="0")
    parser.add_argument("--content-type", default="0")
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    legacy_root = os.path.abspath(args.legacy_root)
    if legacy_root not in sys.path:
      sys.path.insert(0, legacy_root)

    from builder.auth import DouyinAuth
    from dy_apis.douyin_api import DouyinAPI

    auth = DouyinAuth()
    auth.perepare_auth(args.cookie_string)

    payload = DouyinAPI.search_general_work(
        auth,
        args.query,
        sort_type=str(args.sort_type),
        publish_time=str(args.publish_time),
        offset=str(args.offset),
        filter_duration=str(args.filter_duration or ""),
        search_range=str(args.search_range or "0"),
        content_type=str(args.content_type or "0"),
    )

    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(str(error))
        sys.exit(1)
