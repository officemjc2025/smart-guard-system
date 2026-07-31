export interface EvidenceStamp {
  locationName: string;
  capturedAt: Date;
}

export async function stampEvidenceImage(file: File, stamp: EvidenceStamp): Promise<string> {
  const mime = file.type.toLowerCase();
  if (!['image/jpeg', 'image/jpg', 'image/png'].includes(mime)) {
    throw new Error('ไฟล์รูปหลักฐานไม่รองรับ กรุณาใช้รูป JPEG หรือ PNG');
  }
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปหลักฐานได้'));
      element.src = source;
    });
    const maximum = 1600;
    const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('อุปกรณ์ไม่รองรับการประทับข้อมูลบนรูป');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const fontSize = Math.max(18, Math.round(canvas.width * 0.028));
    const padding = Math.max(12, Math.round(fontSize * 0.7));
    const lines = [
      `จุดตรวจ: ${stamp.locationName}`,
      `เวลาถ่ายจากอุปกรณ์: ${stamp.capturedAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
    ];
    const panelHeight = padding * 2 + fontSize * 2.7;
    context.fillStyle = 'rgba(0, 0, 0, 0.68)';
    context.fillRect(0, canvas.height - panelHeight, canvas.width, panelHeight);
    context.fillStyle = '#fff';
    context.font = `600 ${fontSize}px system-ui, sans-serif`;
    context.textBaseline = 'top';
    lines.forEach((line, index) => {
      context.fillText(line, padding, canvas.height - panelHeight + padding + index * fontSize * 1.3, canvas.width - padding * 2);
    });
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(source);
  }
}
