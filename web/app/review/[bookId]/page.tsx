import { Workbench } from "@/components/Workbench";

export default function ReviewPage({ params }: { params: { bookId: string } }) {
  return <Workbench bookId={decodeURIComponent(params.bookId)} />;
}
