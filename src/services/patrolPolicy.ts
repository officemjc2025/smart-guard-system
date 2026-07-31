export interface PatrolCheckinDraft {
  patrolPointId: string;
  patrolPointName: string;
  customLocation: string;
  areaStatus: '' | 'normal' | 'abnormal';
  abnormalReason: string;
  photo1: File | null;
  photo2: File | null;
}

export function validatePatrolCheckinDraft(draft: PatrolCheckinDraft): void {
  if (!draft.patrolPointName.trim() && !draft.customLocation.trim()) {
    throw new Error('กรุณาเลือกจุดตรวจหรือระบุสถานที่');
  }
  if (!draft.areaStatus) throw new Error('กรุณาระบุสถานะพื้นที่');
  if (draft.areaStatus === 'abnormal' && !draft.abnormalReason.trim()) {
    throw new Error('กรุณาระบุรายละเอียดหรือเหตุผลของความผิดปกติ');
  }
  if (!draft.photo1) throw new Error('กรุณาถ่ายรูปหลักฐานจุดตรวจอย่างน้อย 1 รูป');
  if (draft.photo2 && draft.photo1 === draft.photo2) {
    throw new Error('รูปหลักฐานทั้งสองต้องเป็นคนละไฟล์');
  }
}
