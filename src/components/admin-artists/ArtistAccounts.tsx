'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import type {
  AdminArtistDetail,
  ArtistInvitation,
} from '@/config/admin-artists';
import { adminArtistDate } from './ArtistPreviews';
import styles from './admin-artists.module.css';

export function ArtistAccounts({
  detail,
  onInvite,
  onCancel,
  onUnlink,
}: {
  detail: AdminArtistDetail;
  onInvite: (userId: string, manager: boolean) => Promise<unknown>;
  onCancel: (invitation: ArtistInvitation) => Promise<unknown>;
  onUnlink: (userId: string) => Promise<unknown>;
}) {
  const t = useTranslations('adminArtists');
  const [userId, setUserId] = useState('');
  const [manager, setManager] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [invalid, setInvalid] = useState(false);
  return (
    <Card title={t('linksTitle')}>
      <p>{t('linksDescription')}</p>
      {!detail.account_link_ready ? (
        <p role="status">{t('linkDisabled')}</p>
      ) : (
        <form
          className={styles.editor}
          onSubmit={(event) => {
            event.preventDefault();
            if (!confirmed || !z.uuid().safeParse(userId).success) {
              setInvalid(true);
              return;
            }
            void onInvite(userId, manager);
          }}
        >
          <Input
            label={t('targetUserId')}
            hint={t('targetUserIdHint')}
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setConfirmed(false);
              setInvalid(false);
            }}
            required
            autoComplete="off"
          />
          <Checkbox
            label={t('manager')}
            checked={manager}
            onChange={(event) => {
              setManager(event.target.checked);
              setConfirmed(false);
            }}
          />
          <Checkbox
            label={t('linkConfirm')}
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {invalid && <p role="alert">{t('errors.INVALID_INPUT')}</p>}
          <Button type="submit" disabled={!confirmed}>
            {t('linkRequest')}
          </Button>
        </form>
      )}
      <h3>{t('linkRequests')}</h3>
      {detail.invitations_has_more && (
        <p className="ui-hint">{t('boundedInvitations')}</p>
      )}
      {!detail.invitations.length && <p>{t('linkRequestEmpty')}</p>}
      <ul className={styles.list}>
        {detail.invitations.map((invitation) => (
          <li
            key={invitation.id}
            data-admin-invitation-id={invitation.id}
            className={styles.notice}
          >
            <p>{t('linkTarget', { id: invitation.target_user_id })}</p>
            <p>{t(`linkState.${invitation.state}`)}</p>
            <p>
              {t('linkExpires', {
                date: adminArtistDate(invitation.expires_at),
              })}
            </p>
            {invitation.state === 'pending' && (
              <ConfirmAction
                label={t('linkCancel')}
                confirmation={t('cancelInviteConfirm')}
                action={() => onCancel(invitation)}
              />
            )}
          </li>
        ))}
      </ul>
      <h3>{t('members')}</h3>
      <p className="ui-hint">{t('unlinkNote')}</p>
      {detail.members_has_more && (
        <p className="ui-hint">{t('boundedMembers')}</p>
      )}
      {!detail.members.length && <p>{t('membersEmpty')}</p>}
      <ul className={styles.list}>
        {detail.members.map((member) => (
          <li
            key={member.user_id}
            data-admin-member-id={member.user_id}
            className={styles.notice}
          >
            <p>{t('linkTarget', { id: member.user_id })}</p>
            <p>
              {t('memberRole', {
                role: t(member.is_manager ? 'memberManager' : 'memberArtist'),
              })}
            </p>
            <ConfirmAction
              label={t('unlink')}
              confirmation={t('unlinkConfirm')}
              action={() => onUnlink(member.user_id)}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
export function ConfirmAction({
  label,
  confirmation,
  action,
}: {
  label: string;
  confirmation: string;
  action: () => Promise<unknown>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className={styles.stack}>
      <Checkbox
        label={confirmation}
        checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)}
      />
      <Button
        variant="secondary"
        disabled={!confirmed}
        onClick={() => void action()}
      >
        {label}
      </Button>
    </div>
  );
}
