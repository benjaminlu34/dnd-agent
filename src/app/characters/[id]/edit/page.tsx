import { notFound } from "next/navigation";
import { CharacterBuilderApp } from "@/components/character-builder-app";
import { getCharacterTemplateForUser } from "@/lib/game/repository";

type EditCharacterPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCharacterPage({ params }: EditCharacterPageProps) {
  const { id } = await params;
  const character = await getCharacterTemplateForUser(id);

  if (!character) {
    notFound();
  }

  return <CharacterBuilderApp initialCharacter={character} mode="edit" />;
}
