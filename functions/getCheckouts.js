exports.handler = async (event) => {
  const { CookieJar } = await import('tough-cookie');
  const fetchModule = await import('node-fetch');
  const fetchCookieModule = await import('fetch-cookie');

  const fetch = fetchModule.default;
  const fetchCookie = fetchCookieModule.default || fetchCookieModule;

  const jar = new CookieJar();
  const fetchWithCookies = fetchCookie(fetch, jar);

  const LOGIN_URL = "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences";
  const CHECKOUTS_URL = "https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts";

  const { name, user_pin, accountId } = event.queryStringParameters;

  // 1️⃣ Login
  const loginResp = await fetchWithCookies(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ name, user_pin })
  });

  const loginBody = await loginResp.text();
  if (!loginResp.ok || loginBody.includes("Login") || loginBody.includes("incorrect")) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Login failed", detail: loginBody }),
    };
  }

  // 2️⃣ Fetch checkouts
  const url = `${CHECKOUTS_URL}?accountId=${accountId}&size=100&page=1&status=OUT&sort=status&locale=en-US`;
  // Get all cookies for bibliocommons
  const allCookies = await jar.getCookies("https://aclibrary.bibliocommons.com");

  // Manually construct a cookie header string
  const cookieHeader = allCookies.map(c => c.cookieString()).join("; ");

  // Now send checkouts request with explicit Cookie header
  const resp = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader
    }
  });

  if (!resp.ok) {
    const text = await resp.text();
    return {
      statusCode: resp.status,
      body: JSON.stringify({ error: "Failed to fetch checkouts", detail: text })
    };
  }

  const data = await resp.json();

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data)
  };

};
