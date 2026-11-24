import { Controller, Get, Param } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { InvoiceService, type InvoiceView } from './invoice.service';

/** ইনভয়েসের ডেটা — ACCOUNTANT-ও লাগবে, সে-ই বিল নিয়ে কাজ করে। */
@Roles('SUPER_ADMIN', 'ORDER_MANAGER', 'ACCOUNTANT')
@Controller('admin/orders')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get(':orderNumber/invoice')
  build(@Param('orderNumber') orderNumber: string): Promise<InvoiceView> {
    return this.invoices.build(orderNumber);
  }
}
