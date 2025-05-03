// functions/getCheckouts.js
const fetch = require('node-fetch');

exports.handler = async (event) => {
  const { cardNumber, pin, accountId } = event.queryStringParameters;

  // 1. login
  await fetch(
    'https://aclibrary.bibliocommons.com/user/login?destination=%2Faccount%2Fcontact_preferences',
    {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({name: cardNumber, user_pin: pin}),
    }
  );

  // 2. fetch checkouts
  const url = `https://gateway.bibliocommons.com/v2/libraries/aclibrary/checkouts`
    + `?accountId=${accountId}&size=100&page=1&status=OUT&sort=status&locale=en-US`;
  const res = await fetch(url, {headers:{Accept:'application/json'}});
  const data = await res.json();

  return {
    statusCode: 200,
    headers: {'Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(data),
  };
};
