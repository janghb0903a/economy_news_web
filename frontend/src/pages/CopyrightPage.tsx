import { Card } from "../components/ui";
import { COPYRIGHT_HOLDERS, COPYRIGHT_LINE, COPYRIGHT_NOTICE } from "../lib/copyright";

export default function CopyrightPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Copyright</h1>
        <p className="mt-1 text-sm text-muted-foreground">Copyright and usage notice for this local economy news dashboard.</p>
      </div>

      <Card className="p-5">
        <h2 className="text-lg font-semibold">Rights Holders</h2>
        <div className="mt-4 space-y-2">
          {COPYRIGHT_HOLDERS.map((holder) => (
            <div key={`${holder.company}-${holder.name}`} className="grid grid-cols-[160px_1fr] gap-4 text-sm">
              <span className="font-medium text-foreground">{holder.company}</span>
              <span className="text-muted-foreground">{holder.name}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{COPYRIGHT_LINE}</p>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-semibold">Usage Notice</h2>
        <p className="mt-3 leading-7 text-muted-foreground">{COPYRIGHT_NOTICE}</p>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-semibold">Original Source Content</h2>
        <p className="mt-3 leading-7 text-muted-foreground">
          This service organizes RSS feeds and original links for personal news review. Rights in original articles, photos, graphics, videos, and other third-party
          content belong to their respective publishers and rights holders. Detailed review, citation, and verification should be based on the original source links.
        </p>
      </Card>
    </div>
  );
}
