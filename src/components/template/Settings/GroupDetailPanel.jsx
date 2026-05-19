import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  TextInput,
  Title,
} from "@patternfly/react-core";
import {
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@patternfly/react-table";
import React, { useCallback, useEffect, useState } from "react";
import { useDispatch } from "react-redux";

import API from "@/utils/axiosInstance";
import { showToast } from "@/actions/toastActions";

const PERMISSION_OPTIONS = [
  { value: "view", label: "View" },
  { value: "run", label: "Run" },
  { value: "cancel", label: "Cancel" },
  { value: "admin", label: "Admin (view, run, and cancel)" },
];

const GroupDetailPanel = ({ groupId, allUsers, onBack, onChanged }) => {
  const dispatch = useDispatch();
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [newPolicy, setNewPolicy] = useState({
    clusterKey: "*",
    permission: "view",
  });

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get(`/auth/groups/${groupId}`);
      setGroup(res.data.group);
      setMembers(res.data.members || []);
      setPolicies(res.data.policies || []);
      setCanManage(Boolean(res.data.canManage));
    } catch (e) {
      dispatch(
        showToast(
          "danger",
          "Failed to load group",
          e.response?.data?.error || e.message
        )
      );
    } finally {
      setLoading(false);
    }
  }, [dispatch, groupId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const memberIds = new Set(members.map((m) => m.id));
  const usersNotInGroup = allUsers.filter((u) => !memberIds.has(u.id));

  const addMember = async () => {
    if (!addUserId) return;
    try {
      await API.post(`/auth/groups/${groupId}/members`, {
        userId: parseInt(addUserId, 10),
      });
      setAddUserId("");
      dispatch(showToast("success", "Member added"));
      await loadDetail();
      onChanged?.();
    } catch (e) {
      dispatch(
        showToast("danger", "Failed to add member", e.response?.data?.error)
      );
    }
  };

  const removeMember = async (userId) => {
    try {
      await API.delete(`/auth/groups/${groupId}/members/${userId}`);
      dispatch(showToast("success", "Member removed"));
      await loadDetail();
      onChanged?.();
    } catch (e) {
      dispatch(
        showToast("danger", "Failed to remove member", e.response?.data?.error)
      );
    }
  };

  const addPolicy = async () => {
    try {
      await API.post(`/auth/groups/${groupId}/policies`, newPolicy);
      setNewPolicy({ clusterKey: "*", permission: "view" });
      dispatch(showToast("success", "Policy added"));
      await loadDetail();
      onChanged?.();
    } catch (e) {
      dispatch(
        showToast("danger", "Failed to add policy", e.response?.data?.error)
      );
    }
  };

  const removePolicy = async (policyId) => {
    try {
      await API.delete(`/auth/groups/${groupId}/policies/${policyId}`);
      dispatch(showToast("success", "Policy removed"));
      await loadDetail();
      onChanged?.();
    } catch (e) {
      dispatch(
        showToast("danger", "Failed to remove policy", e.response?.data?.error)
      );
    }
  };

  if (loading) {
    return <p className="settings-page__hint">Loading group…</p>;
  }

  if (!group) {
    return (
      <>
        <Button variant="link" onClick={onBack} className="settings-page__back">
          Back to groups
        </Button>
        <p>Group not found.</p>
      </>
    );
  }

  return (
    <div className="settings-page__group-detail">
      <Button variant="link" onClick={onBack} className="settings-page__back">
        Back to groups
      </Button>
      <Title headingLevel="h2" size="lg">
        {group.name}
      </Title>
      {group.description ? (
        <p className="settings-page__hint">{group.description}</p>
      ) : null}

      {!canManage ? (
        <Alert
          variant="info"
          isInline
          title="Read-only"
          className="settings-page__group-alert"
        >
          You must be an admin member of this group to add or remove members and
          policies.
        </Alert>
      ) : null}

      <Title headingLevel="h3" size="md" className="settings-page__section-title">
        Members
      </Title>
      {canManage ? (
        <Form className="settings-form settings-form--inline">
          <FormGroup label="Add user" fieldId="add-group-member">
            <FormSelect
              id="add-group-member"
              value={addUserId}
              onChange={(_e, v) => setAddUserId(v)}
            >
              <FormSelectOption value="" label="Select user…" />
              {usersNotInGroup.map((u) => (
                <FormSelectOption
                  key={u.id}
                  value={String(u.id)}
                  label={`${u.username} (${u.role})`}
                />
              ))}
            </FormSelect>
          </FormGroup>
          <Button onClick={addMember} isDisabled={!addUserId}>
            Add member
          </Button>
        </Form>
      ) : null}
      <Table aria-label="Group members" variant="compact">
        <Thead>
          <Tr>
            <Th>Username</Th>
            <Th>Role</Th>
            {canManage ? <Th>Actions</Th> : null}
          </Tr>
        </Thead>
        <Tbody>
          {members.map((m) => (
            <Tr key={m.id}>
              <Td>{m.username}</Td>
              <Td>{m.role}</Td>
              {canManage ? (
                <Td>
                  <Button variant="danger" onClick={() => removeMember(m.id)}>
                    Remove
                  </Button>
                </Td>
              ) : null}
            </Tr>
          ))}
        </Tbody>
      </Table>

      <Title headingLevel="h3" size="md" className="settings-page__section-title">
        Policies
      </Title>
      <p className="settings-page__hint">
        Policies apply to this group and grant cluster permissions to all members.
      </p>
      {canManage ? (
        <Form className="settings-form">
          <FormGroup label="Cluster key" fieldId="group-policy-cluster">
            <TextInput
              id="group-policy-cluster"
              value={newPolicy.clusterKey}
              onChange={(_e, v) =>
                setNewPolicy({ ...newPolicy, clusterKey: v })
              }
            />
          </FormGroup>
          <FormGroup label="Permission" fieldId="group-policy-permission">
            <FormSelect
              id="group-policy-permission"
              value={newPolicy.permission}
              onChange={(_e, v) =>
                setNewPolicy({ ...newPolicy, permission: v })
              }
            >
              {PERMISSION_OPTIONS.map((o) => (
                <FormSelectOption key={o.value} value={o.value} label={o.label} />
              ))}
            </FormSelect>
          </FormGroup>
          <Button onClick={addPolicy}>Add policy</Button>
        </Form>
      ) : null}
      <Table aria-label="Group policies" variant="compact">
        <Thead>
          <Tr>
            <Th>Cluster</Th>
            <Th>Permission</Th>
            {canManage ? <Th>Actions</Th> : null}
          </Tr>
        </Thead>
        <Tbody>
          {policies.map((p) => (
            <Tr key={p.id}>
              <Td>{p.clusterKey}</Td>
              <Td>{p.permission}</Td>
              {canManage ? (
                <Td>
                  <Button variant="danger" onClick={() => removePolicy(p.id)}>
                    Remove
                  </Button>
                </Td>
              ) : null}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
};

export default GroupDetailPanel;
