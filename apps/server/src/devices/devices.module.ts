import { Module } from '@nestjs/common';
import { DeviceState } from './device-state.js';
import { DevicesController } from './devices.controller.js';

@Module({
  controllers: [DevicesController],
  providers: [DeviceState],
  exports: [DeviceState],
})
export class DevicesModule {}
