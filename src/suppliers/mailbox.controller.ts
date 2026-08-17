import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { MessageResponseDto } from '../users/dto/message-response.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { ConnectMailboxDto } from './dto/connect-mailbox.dto';
import {
  MailboxConnectionDto,
  MailboxConsentDto,
} from './dto/mailbox-connection.dto';
import { MailboxConnectionService } from './mailbox-connection.service';
import { MailboxSyncService } from './mailbox-sync.service';

/**
 * Connecting the owner's mailbox, so purchase requests go out as them and the
 * replies come back on their own.
 *
 * **`OWNER` only, unlike every other route in this module.** An `ADMIN` of a
 * store can run the whole supplier desk — write requests, send them, confirm a
 * deal — but attaching a personal mailbox is not a delegable act: the grant is
 * to a human's private mail, and the human it belongs to is the one who has to
 * consent to it. An admin can still read the status, because a desk that cannot
 * see why replies stopped arriving is a desk that quietly stops working.
 */
@Controller('mailbox')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MailboxController {
  constructor(
    private readonly connectionService: MailboxConnectionService,
    private readonly syncService: MailboxSyncService,
  ) {}

  /**
   * What the dashboard needs to draw the panel: whether this server supports
   * mailbox sending at all, whether this store has connected one, and — the line
   * that matters — whether it has stopped working.
   */
  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async status(@CurrentUser() user: JwtPayload): Promise<MailboxConnectionDto> {
    const { connection, isSupported } =
      await this.connectionService.findForCaller(user);
    return MailboxConnectionDto.fromEntity(connection, { isSupported });
  }

  /**
   * Step one: where to send the owner to consent.
   *
   * The `state` comes back so the frontend can hand it to the callback screen;
   * the copy stored server-side is the one that is actually trusted.
   */
  @Post('connect')
  @Roles(UserRole.OWNER)
  async startConnect(
    @CurrentUser() user: JwtPayload,
  ): Promise<MailboxConsentDto> {
    return MailboxConsentDto.of(
      await this.connectionService.startConnect(user),
    );
  }

  /**
   * Step two: the code Google handed the redirect URI, exchanged server-side.
   *
   * A POST rather than a `GET` Google redirects into, so the client secret stays
   * on the server and the callback page is an ordinary authenticated screen
   * instead of a public route.
   */
  @Post('callback')
  @Roles(UserRole.OWNER)
  async completeConnect(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConnectMailboxDto,
  ): Promise<MailboxConnectionDto> {
    const connection = await this.connectionService.completeConnect(user, dto);
    return MailboxConnectionDto.fromEntity(connection, {
      isSupported: this.connectionService.isSupported(),
    });
  }

  /**
   * Forgets the grant. Requests already sent keep their thread ids, so
   * reconnecting later picks their replies up rather than starting over — and the
   * paste route never stopped working in the meantime.
   */
  @Delete()
  @Roles(UserRole.OWNER)
  async disconnect(
    @CurrentUser() user: JwtPayload,
  ): Promise<MessageResponseDto> {
    await this.connectionService.disconnect(user);
    return {
      message:
        'Mailbox disconnected. Supplier replies can still be pasted in by hand.',
    };
  }

  /**
   * Reads this store's replies now rather than at the next pass.
   *
   * The button an owner presses while looking at the screen — the same impulse
   * `POST /knowledge/reindex` serves. It runs one store's pass only, and reports
   * what it found rather than a bare acknowledgement.
   */
  @Post('sync')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async syncNow(@CurrentUser() user: JwtPayload): Promise<MessageResponseDto> {
    const { connection, isSupported } =
      await this.connectionService.findForCaller(user);

    if (!isSupported || !connection) {
      return {
        message:
          'No mailbox is connected, so there is nothing to read. Paste a reply instead.',
      };
    }

    const outcome = await this.syncService.syncStore(connection);
    if (!outcome) {
      return {
        message:
          'Nothing to read: no sent request is still waiting on a supplier.',
      };
    }

    return {
      message: `Checked ${outcome.threadsWatched} thread(s) and read ${outcome.repliesRead} new repl${outcome.repliesRead === 1 ? 'y' : 'ies'}.`,
    };
  }
}
