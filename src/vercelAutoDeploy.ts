import { Vercel } from '@vercel/sdk';

export const publishToVercel = () => {
  const vercel = new Vercel({
    bearerToken: 'UhU4oukWA7bDnVklHmBl3DPw',
    // bearerToken: process.env.VERCEL_TOKEN,
  });

  async function createDeploymentAndAlias() {
    try {
      // Create a new deployment
      const createResponse = await vercel.deployments.createDeployment({
        requestBody: {
          name: 'turnip', //The project name used in the deployment URL
          target: 'production',
          gitSource: {
            type: 'github',
            repo: 'turnip',
            ref: 'main',
            org: 'TurnipXenon', //For a personal account, the org-name is your GH username
          },
        },
      });

      const deploymentId = createResponse.id;

      console.log(`Deployment created: ID ${deploymentId} and status ${createResponse.status}`);

      // Check deployment status
      let deploymentStatus;
      let deploymentURL;
      do {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds between checks

        const statusResponse = await vercel.deployments.getDeployment({
          idOrUrl: deploymentId,
          withGitRepoInfo: 'true',
        });

        deploymentStatus = statusResponse.status;
        deploymentURL = statusResponse.url;
        console.log(`Deployment status: ${deploymentStatus}`);
      } while (deploymentStatus === 'BUILDING' || deploymentStatus === 'INITIALIZING');

      if (deploymentStatus === 'READY') {
        console.log(`Deployment successful. URL: ${deploymentURL}`);

        const aliasResponse = await vercel.aliases.assignAlias({
          id: deploymentId,
          requestBody: {
            alias: `content-update`,
            redirect: null,
          },
        });

        console.log(`Alias created: ${aliasResponse.alias}`);
      } else {
        console.log('Deployment failed or was canceled');
      }
    } catch (error) {
      console.error(error instanceof Error ? `Error: ${error.message}` : String(error));
    }
  }

  createDeploymentAndAlias();
};

// const logsResponse = await vercel.deployments.getDeploymentEvents({
//   idOrUrl: 'your-project-name.vercel.app',
// });
//
// if (Array.isArray(logsResponse) && 'deploymentId' in logsResponse[0]) {
//   const latestDeploymentId = logsResponse[0].deploymentId;
// }
//
// const deploymentStatus = await vercel.deployments.getDeployment({
//   idOrUrl: latestDeploymentId,
// });
