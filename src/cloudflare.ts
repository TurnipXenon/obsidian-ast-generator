import { Notice, requestUrl } from 'obsidian';

export interface CloudflareConfig {
  accountId: string;
  triggerId: string;
  apiToken: string;
  webRepoPath: string;
}

export async function triggerCloudflareDeployment(
  cf: CloudflareConfig,
  commitHash: string,
  notice: Notice
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${cf.apiToken}`,
    'Content-Type': 'application/json',
  };

  // Trigger new Workers build
  const deployRes = await requestUrl({
    url: `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/builds/triggers/${cf.triggerId}/builds`,
    method: 'POST',
    headers,
    body: JSON.stringify({ branch: 'main', commit_hash: commitHash }),
    throw: false,
  });
  const deployData: any = deployRes.json;
  if (!deployData.success) {
    throw new Error(deployData.errors?.[0]?.message ?? 'Cloudflare build trigger failed');
  }

  const buildUuid: string = deployData.result.build_uuid;

  // Poll until done (~5s intervals, max 20 min)
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await requestUrl({
      url: `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/builds/builds/${buildUuid}`,
      headers,
      throw: false,
    });
    const statusData: any = statusRes.json;
    const result = statusData.result;
    const status: string = result?.status ?? 'queued';
    const outcome: string | null = result?.build_outcome ?? null;

    if (outcome === 'success') return;
    if (outcome !== null) {
      throw new Error(`Cloudflare build ${outcome} (status: ${status})`);
    }
    notice.setMessage(`Cloudflare: deploying… (${status})`);
  }

  throw new Error('Cloudflare deployment timed out after 20 minutes');
}
