import { Card, CardContent } from "@/components/ui/card";

/**
 * Estado vazio.
 *
 * O Dashboard e a Carteira funcionam sem o seed: uma base recém-criada mostra
 * este bloco com o próximo passo, em vez de zeros ou erro.
 */
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-md text-sm text-[var(--muted-foreground)]">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
