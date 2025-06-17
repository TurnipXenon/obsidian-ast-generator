# Notes

POST https://vercel.com/api/v13/deployments?forceNew=1&teamId=team_3hvokPyK211ZJM5IFf8EwUUX&withCache=1

```json
{
  "deploymentId": "dpl_HK9YHEdS7MYwJdm6fQSReLaJhcmN",
  "meta": {
    "action": "redeploy"
  },
  "name": "turnip",
  "target": "production"
}
```

see docs: https://vercel.com/docs/rest-api/reference/endpoints/deployments/list-deployments
```ts
const vercel = new Vercel({
  bearerToken: process.env.VERCEL_TOKEN,
});

const logsResponse = await vercel.deployments.getDeploymentEvents({
  idOrUrl: 'your-project-name.vercel.app',
});

if (Array.isArray(logsResponse) && 'deploymentId' in logsResponse[0]) {
  const latestDeploymentId = logsResponse[0].deploymentId;
}

const deploymentStatus = await vercel.deployments.getDeployment({
  idOrUrl: latestDeploymentId,
});
```
