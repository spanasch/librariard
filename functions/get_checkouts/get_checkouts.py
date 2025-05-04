# functions/get_checkouts.py

import json
import urllib.parse
import requests

LOGIN_URL     = "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences"
CHECKOUTS_URL = "https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts"

def handler(event, context):
    # Extract query parameters
    params = event.get("queryStringParameters") or {}
    name = params.get("name")
    user_pin = params.get("user_pin")
    account_id = params.get("accountId")

    if not all([name, user_pin, account_id]):
        return {
            "statusCode": 400,
            "body": json.dumps({ "error": "Missing name, user_pin, or accountId" }),
        }

    try:
        # Use a session to maintain cookies
        session = requests.Session()

        # Perform login
        payload = { "name": name, "user_pin": user_pin }
        login_resp = session.post(
            LOGIN_URL,
            headers={ "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            data=urllib.parse.urlencode(payload)
        )
        login_resp.raise_for_status()

        # Fetch checkouts
        params = {
            "accountId": account_id,
            "size":      100,
            "status":    "OUT",
            "page":      1,
            "sort":      "status",
            "locale":    "en-US"
        }
        r = session.get(
            CHECKOUTS_URL,
            headers={ "Accept": "application/json" },
            params=params
        )
        r.raise_for_status()

        return {
            "statusCode": 200,
            "headers": { "Access-Control-Allow-Origin": "*" },
            "body": json.dumps(r.json())
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({ "error": str(e) })
        }
