# backend/get_checkouts.py

import json
import urllib.parse
import requests
import os
import logging

LOGIN_URL     = "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences"
CHECKOUTS_URL = "https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts"
logger = logging.getLogger("librariard.backend.get_checkouts")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

def handle_checkout(params):
    name = params.get("name")
    user_pin = params.get("user_pin")
    account_id = params.get("accountId")

    if not all([name, user_pin, account_id]):
        return {
            "statusCode": 400,
            "body": { "error": "Missing name, user_pin, or accountId" }
        }

    try:
        session = requests.Session()

        # Login
        payload = { "name": name, "user_pin": user_pin }
        try:
            masked_name = (str(name)[-4:].rjust(len(str(name) or ''), 'x')) if name else ''
            masked_data = urllib.parse.urlencode({ "name": masked_name, "user_pin": "****" })
            logger.info("POST %s data=%s", LOGIN_URL, masked_data)
            if str(os.getenv("LOG_FULL_QUERIES", "")).lower() in ("1", "true", "yes", "on"):
                logger.warning("FULL POST %s data=%s", LOGIN_URL, urllib.parse.urlencode(payload))
        except Exception:
            # Do not let logging break functionality
            pass
        login_resp = session.post(
            LOGIN_URL,
            headers={ "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            data=urllib.parse.urlencode(payload)
        )
        login_resp.raise_for_status()

        # Fetch checkouts
        params_get = {
            "accountId": account_id,
            "size": 100,
            "page": 1,
            "sort": "status",
            "materialType": "PHYSICAL",
            "locale": "en-US"
        }
        try:
            masked_account = (str(account_id)[-4:].rjust(len(str(account_id) or ''), 'x')) if account_id else ''
            masked_qs = urllib.parse.urlencode({ **params_get, "accountId": masked_account })
            logger.info("GET %s?%s", CHECKOUTS_URL, masked_qs)
            if str(os.getenv("LOG_FULL_QUERIES", "")).lower() in ("1", "true", "yes", "on"):
                logger.warning("FULL GET %s?%s", CHECKOUTS_URL, urllib.parse.urlencode(params_get))
        except Exception:
            pass
        checkout_resp = session.get(
            CHECKOUTS_URL,
            headers={ "Accept": "application/json" },
            params=params_get
        )
        checkout_resp.raise_for_status()
        return {
            "statusCode": 200,
            "body": checkout_resp.json()
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "body": { "error": str(e) }
        }
