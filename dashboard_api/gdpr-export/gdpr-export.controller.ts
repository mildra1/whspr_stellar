import { 
  Controller, Post, Get, Delete, Param, Body, Res, UseGuards, Req, StreamableFile 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { GdprExportService } from './gdpr-export.service';
import { CreateExportDto } from './dto/create-export.dto';
// import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // Uncomment and adjust

@ApiTags('GDPR Export')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard) // Uncomment to enable auth
@Controller('gdpr-exports')
export class GdprExportController {
  constructor(private readonly exportService: GdprExportService) {}

  @Post()
  @ApiOperation({ summary: 'Request a new GDPR data export' })
  async create(@Body() dto: CreateExportDto, @Req() req: any) {
    const requestedBy = req.user?.id || 'admin'; // Get from auth
    return this.exportService.create(dto, requestedBy);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get export status' })
  async findOne(@Param('id') id: string) {
    return this.exportService.findOne(id);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get all exports for a user' })
  async findByUser(@Param('userId') userId: string) {
    return this.exportService.findByUser(userId);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download export file (streaming)' })
  async download(
    @Param('id') id: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = req.user?.id || req.params.userId; // Adjust based on your auth
    const { stream, filename, encrypted } = await this.exportService.download(id, userId);

    res.set({
      'Content-Type': encrypted ? 'application/octet-stream' : 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Encrypted': encrypted.toString(),
    });

    return new StreamableFile(stream);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete export manually' })
  async remove(@Param('id') id: string) {
    await this.exportService.remove(id);
    return { message: 'Export deleted successfully' };
  }
}

// 