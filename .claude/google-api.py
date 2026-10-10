#!/usr/bin/env python3
"""Read-only Google API GET using the owner's clasp sign-in (~/.clasprc.json).

Usage: python3 -I .claude/google-api.py <https://*.googleapis.com/... URL>
       python3 -I .claude/google-api.py --post-logs '<json body>'   (Cloud Logging entries:list, a read)

Only GET requests to *.googleapis.com, plus the one read-only Logging query, are possible.
The access token is never printed or written to disk.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

LOGS_LIST = 'https://logging.googleapis.com/v2/entries:list'


def token():
    tokens = json.load(open(os.path.expanduser('~/.clasprc.json')))['tokens']['default']
    data = urllib.parse.urlencode({
        'client_id': tokens['client_id'], 'client_secret': tokens['client_secret'],
        'refresh_token': tokens['refresh_token'], 'grant_type': 'refresh_token'}).encode()
    return json.load(urllib.request.urlopen('https://oauth2.googleapis.com/token', data))['access_token']


def call(url, body=None):
    request = urllib.request.Request(url, data=body, headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(request))
    except urllib.error.HTTPError as error:
        return {'http_error': error.code, 'body': error.read().decode()[:1000]}


def main(argv):
    if len(argv) == 3 and argv[1] == '--post-logs':
        print(json.dumps(call(LOGS_LIST, json.dumps(json.loads(argv[2])).encode()), indent=1))
        return 0
    if len(argv) != 2:
        print(__doc__)
        return 2
    host = urllib.parse.urlparse(argv[1]).hostname or ''
    if not argv[1].startswith('https://') or not host.endswith('.googleapis.com'):
        print('Only https://*.googleapis.com URLs are allowed.')
        return 2
    print(json.dumps(call(argv[1]), indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
