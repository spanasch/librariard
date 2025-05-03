// functions/getCheckouts.js

exports.handler = async (event) => {
  const { cardNumber, pin, accountId } = event.queryStringParameters;

  // 1️. Login (cookies kept server-side)
  await fetch(
    "https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: cardNumber, user_pin: pin }),
    }
  );

  // 2️. Grab checkouts
  const url =
    `https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts` +
    `?accountId=${accountId}&size=100&page=1&status=OUT&sort=status&locale=en-US`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await resp.json();

  return {
    statusCode: 200,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(data),
  };
};
