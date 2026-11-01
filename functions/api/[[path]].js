export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetHost = 'https://antenna-vinyl-different-expensive.trycloudflare.com';
  const targetUrl = targetHost + url.pathname + url.search;

  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
      }
    });
  }

  const reqHeaders = new Headers(context.request.headers);
  reqHeaders.delete('host');

  const fetchOptions = {
    method: context.request.method,
    headers: reqHeaders,
    redirect: 'follow'
  };

  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    const bodyBuffer = await context.request.arrayBuffer();
    fetchOptions.body = bodyBuffer;
  }

  try {
    const response = await fetch(targetUrl, fetchOptions);

    const resHeaders = new Headers(response.headers);
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    resHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: resHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ 
      error: 'Error de conexión con el backend: ' + err.message,
      target: targetUrl 
    }), {
      status: 502,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
