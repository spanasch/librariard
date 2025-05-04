// functions/getCheckouts.js

const { CookieJar } = await import('tough-cookie');
const fetchModule = await import('node-fetch');
const fetchCookieModule = await import('fetch-cookie');
const fetch = fetchModule.default;
const fetchCookie = fetchCookieModule.default;

const jar = new CookieJar();
const fetchWithCookies = fetchCookie(fetch, jar);

const LOGIN_URL     = "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences";
const CHECKOUTS_URL = "https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts";

exports.handler = async (event) => {
  const { CookieJar } = await import('tough-cookie');
  const fetchModule = await import('node-fetch');
  const fetchCookieModule = await import('fetch-cookie');
  const fetch = fetchModule.default;
  const fetchCookie = fetchCookieModule.default;

  const jar = new CookieJar();
  const fetchWithCookies = fetchCookie(fetch, jar);

  const { name, user_pin, accountId } = event.queryStringParameters;

  const LOGIN_URL     = "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences";
  const CHECKOUTS_URL = "https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts";

  await fetchWithCookies(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ name, user_pin })
  });

  const url = `${CHECKOUTS_URL}?accountId=${accountId}&size=100&page=1&status=OUT&sort=status&locale=en-US`;
  const resp = await fetchWithCookies(url, { headers: { Accept: 'application/json' } });
  const data = await resp.json();

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data),
  };
};

