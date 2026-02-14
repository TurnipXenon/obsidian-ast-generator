import { Notice } from 'obsidian';

export interface CloudflareConfig {
  accountId: string;
  projectName: string;
  apiToken: string;
}

export async function triggerCloudflareDeployment(
  cf: CloudflareConfig,
  notice: Notice
): Promise<void> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/pages/projects/${cf.projectName}`;
  const headers = {
    Authorization: `Bearer ${cf.apiToken}`,
    'Content-Type': 'application/json',
  };

  // Trigger new Pages deployment (rebuilds from latest git commit on production branch)
  const deployRes = await fetch(`${base}/deployments`, { method: 'POST', headers });
  const deployData: any = await deployRes.json();
  if (!deployData.success) {
    throw new Error(deployData.errors?.[0]?.message ?? 'Cloudflare deploy trigger failed');
  }

  const deploymentId: string = deployData.result.id;

  // Poll until done (~5s intervals, max ~10 min)
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(`${base}/deployments/${deploymentId}`, { headers });
    const statusData: any = await statusRes.json();
    const stage = statusData.result?.latest_stage;
    const stageName: string = stage?.name ?? 'building';
    const stageStatus: string = stage?.status ?? 'active';

    if (stageStatus === 'success') return;
    if (stageStatus === 'failure' || stageStatus === 'canceled') {
      throw new Error(`Cloudflare deployment ${stageStatus} at stage "${stageName}"`);
    }
    notice.setMessage(`Cloudflare: deploying… (${stageName})`);
  }

  throw new Error('Cloudflare deployment timed out after 10 minutes');
}
