import { MeetingDetail } from "@/components/meeting-detail";

export default async function MeetingDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <MeetingDetail meetingId={id} />;
}
