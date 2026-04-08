import { Suspense } from "react";
import { CharacterBuilderApp } from "@/components/character-builder-app";

export default function NewCharacterPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CharacterBuilderApp />
    </Suspense>
  );
}
