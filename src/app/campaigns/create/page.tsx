import { CampaignCreationApp } from "@/components/campaign-creation-app";

export default async function CampaignCreationPage({
  searchParams,
}: {
  searchParams: Promise<{ moduleId?: string; templateId?: string }>;
}) {
  const params = await searchParams;

  return (
    <CampaignCreationApp
      moduleId={params.moduleId ?? null}
      templateId={params.templateId ?? null}
    />
  );
}
