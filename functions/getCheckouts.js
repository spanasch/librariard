// functions/getCheckouts.js

const fetch = require('node-fetch');
const { CookieJar } = require('tough-cookie');
const fetchCookie = require('fetch-cookie/node-fetch');

const jar = new CookieJar();
const fetchWithCookies = fetchCookie(fetch, jar);

const LOGIN_URL     = "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences";
const CHECKOUTS_URL = "https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts";

exports.handler = async (event) => {
  const { name, user_pin, accountId } = event.queryStringParameters;

  // 1️⃣ Perform login; cookie jar captures the session cookie
  await fetchWithCookies(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ name, user_pin })
  });

  // 2️⃣ Fetch checkouts using the same cookie jar
  const url = `${CHECKOUTS_URL}?accountId=${accountId}&size=100&page=1&status=OUT&sort=status&locale=en-US`;
  const resp = await fetchWithCookies(url, { headers: { Accept: 'application/json' } });
  const data = await resp.json();

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data),
  };
};
