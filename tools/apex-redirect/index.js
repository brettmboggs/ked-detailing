// kedservice.com → https://www.kedservice.com, 301, path and query kept.
//
// The Pages project serves both hosts, so without this every page exists twice.
// A dashboard Redirect Rule would do the same job, but wrangler's login cannot
// write those; it can deploy this. Only apex traffic reaches it.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = 'https:';
    url.hostname = 'www.kedservice.com';
    return Response.redirect(url.href, 301);
  },
};
