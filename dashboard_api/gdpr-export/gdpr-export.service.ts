import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createWriteStream, createReadStream, promises as fs } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import * as archiver from 'archiver';
import { parse } from 'json2csv';
import { GdprExport, ExportStatus } from './entities/gdpr-export.entity';
import { CreateExportDto, ExportFormat } from './dto/create-export.dto';

@Injectable()
export class GdprExportService {
  private readonly EXPORT_DIR = join(process.cwd(), 'exports');
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-cbc';
  private readonly EXPIRY_DAYS = 7;

  constructor(
    @InjectRepository(GdprExport)
    private readonly exportRepo: Repository<GdprExport>,
  ) {
    this.ensureExportDir();
  }

  private async ensureExportDir() {
    try {
      await fs.mkdir(this.EXPORT_DIR, { recursive: true });
    } catch (error) {
      console.error('Failed to create export directory:', error);
    }
  }

  // CREATE: Request export
  async create(dto: CreateExportDto, requestedBy: string): Promise<GdprExport> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.EXPIRY_DAYS);

    const exportRecord = this.exportRepo.create({
      userId: dto.userId,
      requestedBy,
      format: dto.format,
      selectedFields: dto.fields,
      isEncrypted: dto.encrypt || false,
      expiresAt,
      status: ExportStatus.PENDING,
    });

    const saved = await this.exportRepo.save(exportRecord);

    // Process asynchronously
    this.processExport(saved.id).catch(err => 
      console.error(`Export processing failed for ${saved.id}:`, err)
    );

    return saved;
  }

  // READ: Generate file (internal processing)
  private async processExport(exportId: string): Promise<void> {
    const exportRecord = await this.exportRepo.findOne({ where: { id: exportId } });
    if (!exportRecord) return;

    try {
      await this.exportRepo.update(exportId, { status: ExportStatus.PROCESSING });

      // Fetch user data (replace with your actual data fetching logic)
      const userData = await this.fetchUserData(
        exportRecord.userId,
        exportRecord.selectedFields,
      );

      // Generate file based on format
      const filePath = await this.generateFile(
        userData,
        exportRecord.format,
        exportId,
      );

      // Encrypt if requested
      let finalPath = filePath;
      let encryptionKey: string | null = null;

      if (exportRecord.isEncrypted) {
        const encrypted = await this.encryptFile(filePath);
        finalPath = encrypted.path;
        encryptionKey = encrypted.key;
        await fs.unlink(filePath); // Remove unencrypted file
      }

      await this.exportRepo.update(exportId, {
        status: ExportStatus.COMPLETED,
        filePath: finalPath,
        encryptionKey,
      });
    } catch (error) {
      console.error(`Export failed for ${exportId}:`, error);
      await this.exportRepo.update(exportId, { status: ExportStatus.FAILED });
    }
  }

  // Fetch user data from various sources
  private async fetchUserData(userId: string, fields?: string[]): Promise<any> {
    // TODO: Replace with actual data fetching from your databases
    // This should aggregate data from multiple sources (users, orders, logs, etc.)
    
    const userData = {
      user: {
        id: userId,
        email: 'user@example.com',
        name: 'John Doe',
        createdAt: new Date(),
      },
      orders: [
        { id: '1', amount: 100, date: new Date() },
        { id: '2', amount: 200, date: new Date() },
      ],
      activity: [
        { action: 'login', timestamp: new Date() },
        { action: 'purchase', timestamp: new Date() },
      ],
    };

    // Filter fields if specified
    if (fields && fields.length > 0) {
      return this.filterFields(userData, fields);
    }

    return userData;
  }

  private filterFields(data: any, fields: string[]): any {
    const filtered: any = {};
    for (const field of fields) {
      const keys = field.split('.');
      let current = data;
      let valid = true;

      for (const key of keys) {
        if (current && current[key] !== undefined) {
          current = current[key];
        } else {
          valid = false;
          break;
        }
      }

      if (valid) {
        this.setNestedValue(filtered, keys, current);
      }
    }
    return filtered;
  }

  private setNestedValue(obj: any, keys: string[], value: any) {
    const lastKey = keys.pop()!;
    const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
    target[lastKey] = value;
  }

  // Generate file in requested format
  private async generateFile(
    data: any,
    format: ExportFormat,
    exportId: string,
  ): Promise<string> {
    const filename = `export-${exportId}.${format}`;
    const filePath = join(this.EXPORT_DIR, filename);

    if (format === ExportFormat.JSON) {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } else if (format === ExportFormat.CSV) {
      const flatData = this.flattenObject(data);
      const csv = parse([flatData]);
      await fs.writeFile(filePath, csv);
    }

    return filePath;
  }

  private flattenObject(obj: any, prefix = ''): any {
    return Object.keys(obj).reduce((acc: any, key: string) => {
      const pre = prefix.length ? `${prefix}.` : '';
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        Object.assign(acc, this.flattenObject(obj[key], pre + key));
      } else {
        acc[pre + key] = obj[key];
      }
      return acc;
    }, {});
  }

  // Encrypt file
  private async encryptFile(filePath: string): Promise<{ path: string; key: string }> {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv);

    const encryptedPath = `${filePath}.enc`;
    const input = createReadStream(filePath);
    const output = createWriteStream(encryptedPath);

    return new Promise((resolve, reject) => {
      input
        .pipe(cipher)
        .pipe(output)
        .on('finish', () => {
          const keyString = Buffer.concat([iv, key]).toString('base64');
          resolve({ path: encryptedPath, key: keyString });
        })
        .on('error', reject);
    });
  }

  // UPDATE: Secure download (stream to response)
  async download(exportId: string, userId: string): Promise<{ stream: Readable; filename: string; encrypted: boolean }> {
    const exportRecord = await this.exportRepo.findOne({ where: { id: exportId } });

    if (!exportRecord) {
      throw new NotFoundException('Export not found');
    }

    // Verify access (admin or owner)
    if (exportRecord.userId !== userId) {
      throw new BadRequestException('Unauthorized access to export');
    }

    if (exportRecord.status !== ExportStatus.COMPLETED) {
      throw new BadRequestException('Export is not ready for download');
    }

    if (new Date() > exportRecord.expiresAt) {
      throw new BadRequestException('Export has expired');
    }

    // Mark as downloaded
    await this.exportRepo.update(exportId, { downloadedAt: new Date() });

    const stream = createReadStream(exportRecord.filePath);
    const filename = exportRecord.filePath.split('/').pop()!;

    return {
      stream,
      filename,
      encrypted: exportRecord.isEncrypted,
    };
  }

  // Get export status
  async findOne(id: string): Promise<GdprExport> {
    const exportRecord = await this.exportRepo.findOne({ where: { id } });
    if (!exportRecord) {
      throw new NotFoundException('Export not found');
    }
    return exportRecord;
  }

  // List user's exports
  async findByUser(userId: string): Promise<GdprExport[]> {
    return this.exportRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // DELETE: Manual delete
  async remove(id: string): Promise<void> {
    const exportRecord = await this.exportRepo.findOne({ where: { id } });
    if (!exportRecord) {
      throw new NotFoundException('Export not found');
    }

    // Delete file if exists
    if (exportRecord.filePath) {
      try {
        await fs.unlink(exportRecord.filePath);
      } catch (error) {
        console.error(`Failed to delete file ${exportRecord.filePath}:`, error);
      }
    }

    await this.exportRepo.delete(id);
  }

  // DELETE: Auto-cleanup expired exports (runs daily)
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredExports(): Promise<void> {
    const expired = await this.exportRepo.find({
      where: { expiresAt: LessThan(new Date()) },
    });

    for (const exp of expired) {
      try {
        await this.remove(exp.id);
      } catch (error) {
        console.error(`Failed to cleanup export ${exp.id}:`, error);
      }
    }

    console.log(`Cleaned up ${expired.length} expired exports`);
  }
}

