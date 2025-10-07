import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { GdprExportService } from './gdpr-export.service';
import { GdprExportController } from './gdpr-export.controller';
import { GdprExport } from './entities/gdpr-export.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([GdprExport]),
    ScheduleModule.forRoot(),
  ],
  controllers: [GdprExportController],
  providers: [GdprExportService],
  exports: [GdprExportService],
})
export class GdprExportModule {}

