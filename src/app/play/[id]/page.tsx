import { AdventureApp } from "@/components/adventure-app";

type PlayPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PlayPage({ params }: PlayPageProps) {
  const { id } = await params;

  return <AdventureApp initialCampaignId={id} />;
}
