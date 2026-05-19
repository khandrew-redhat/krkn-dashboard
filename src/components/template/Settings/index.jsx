import "./index.less";

import {
  Button,
  Checkbox,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Modal,
  ModalVariant,
  Tab,
  Tabs,
  TabTitleText,
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
import { useDispatch, useSelector } from "react-redux";
import API from "@/utils/axiosInstance";
import { fetchAdminGroups } from "@/actions/authActions";
import { showToast } from "@/actions/toastActions";
import GroupDetailPanel from "./GroupDetailPanel";

const Settings = () => {
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const [activeTab, setActiveTab] = useState(0);
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [kubeconfigs, setKubeconfigs] = useState([]);
  const [audit, setAudit] = useState([]);

  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    role: "user",
    groupIds: [],
  });
  const [newGroup, setNewGroup] = useState({ name: "", description: "" });
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [editGroupsUser, setEditGroupsUser] = useState(null);
  const [editGroupIds, setEditGroupIds] = useState([]);

  const loadAll = useCallback(async () => {
    const [u, p, k, a] = await Promise.all([
      API.get("/auth/users"),
      API.get("/auth/policies"),
      API.get("/auth/kubeconfigs"),
      API.get("/auth/audit"),
    ]);
    setUsers(u.data.users || []);
    setPolicies(p.data.policies || []);
    setKubeconfigs(k.data.kubeconfigs || []);
    setAudit(a.data.events || []);
    const g = await dispatch(fetchAdminGroups());
    setGroups(g || []);
  }, [dispatch]);

  useEffect(() => {
    if (user?.role === "admin") loadAll();
  }, [user, loadAll]);

  if (user?.role !== "admin") {
    return (
      <div className="settings-page">
        <Title headingLevel="h1" size="2xl">
          Account
        </Title>
        <p>
          Signed in as <strong>{user?.username}</strong> ({user?.role})
        </p>
        <p className="settings-page__hint">
          User and group administration is available to platform admins only.
        </p>
      </div>
    );
  }

  const toggleNewUserGroup = (groupId, checked) => {
    setNewUser((prev) => {
      const ids = new Set(prev.groupIds || []);
      if (checked) ids.add(groupId);
      else ids.delete(groupId);
      return { ...prev, groupIds: [...ids] };
    });
  };

  const createUser = async () => {
    await API.post("/auth/users", {
      username: newUser.username,
      password: newUser.password,
      role: newUser.role,
      groupIds: newUser.groupIds || [],
    });
    dispatch(showToast("success", "User created"));
    setNewUser({ username: "", password: "", role: "user", groupIds: [] });
    loadAll();
  };

  const createGroup = async () => {
    await API.post("/auth/groups", newGroup);
    dispatch(showToast("success", "Group created"));
    setNewGroup({ name: "", description: "" });
    loadAll();
  };

  const openEditGroups = (u) => {
    setEditGroupsUser(u);
    setEditGroupIds([...(u.groupIds || [])]);
  };

  const toggleEditGroup = (groupId, checked) => {
    setEditGroupIds((prev) => {
      const ids = new Set(prev);
      if (checked) ids.add(groupId);
      else ids.delete(groupId);
      return [...ids];
    });
  };

  const saveUserGroups = async () => {
    if (!editGroupsUser) return;
    try {
      await API.patch(`/auth/users/${editGroupsUser.id}`, {
        groupIds: editGroupIds,
      });
      dispatch(showToast("success", "Groups updated"));
      setEditGroupsUser(null);
      loadAll();
    } catch (e) {
      dispatch(
        showToast("danger", "Failed to update groups", e.response?.data?.error)
      );
    }
  };

  const uploadKubeconfig = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("name", file.name);
    await API.post("/auth/kubeconfigs", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    dispatch(showToast("success", "Kubeconfig uploaded"));
    loadAll();
  };

  return (
    <div className="settings-page">
      <Title headingLevel="h1" size="2xl" className="settings-page__title">
        Administration
      </Title>
      <Tabs
        className="settings-page__tabs"
        activeKey={activeTab}
        onSelect={(_e, k) => setActiveTab(k)}
      >
        <Tab eventKey={0} title={<TabTitleText>Users</TabTitleText>}>
          <Form className="settings-form">
            <FormGroup label="Username">
              <TextInput
                value={newUser.username}
                onChange={(_e, v) => setNewUser({ ...newUser, username: v })}
              />
            </FormGroup>
            <FormGroup label="Password">
              <TextInput
                type="password"
                value={newUser.password}
                onChange={(_e, v) => setNewUser({ ...newUser, password: v })}
              />
            </FormGroup>
            <FormGroup label="Role" fieldId="new-user-role">
              <FormSelect
                id="new-user-role"
                value={newUser.role}
                onChange={(_e, v) => setNewUser({ ...newUser, role: v })}
              >
                <FormSelectOption value="user" label="User" />
                <FormSelectOption value="viewer" label="Viewer" />
                <FormSelectOption value="admin" label="Admin" />
              </FormSelect>
            </FormGroup>
            <FormGroup label="Groups" fieldId="new-user-groups">
              {groups.length === 0 ? (
                <p className="settings-page__hint">
                  No groups yet. Create a group on the Groups tab first.
                </p>
              ) : (
                <div className="settings-page__group-checkboxes">
                  {groups.map((g) => (
                    <Checkbox
                      key={g.id}
                      id={`new-user-group-${g.id}`}
                      label={g.name}
                      isChecked={(newUser.groupIds || []).includes(g.id)}
                      onChange={(_e, checked) => toggleNewUserGroup(g.id, checked)}
                    />
                  ))}
                </div>
              )}
            </FormGroup>
            <Button onClick={createUser}>Create user</Button>
          </Form>
          <Table aria-label="Users">
            <Thead>
              <Tr>
                <Th>Username</Th>
                <Th>Role</Th>
                <Th>Groups</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {users.map((u) => (
                <Tr key={u.id}>
                  <Td>{u.username}</Td>
                  <Td>{u.role}</Td>
                  <Td>
                    {(u.groupIds || [])
                      .map((gid) => groups.find((g) => g.id === gid)?.name)
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </Td>
                  <Td>
                    <Button variant="link" onClick={() => openEditGroups(u)}>
                      Edit groups
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Tab>
        <Tab eventKey={1} title={<TabTitleText>Groups</TabTitleText>}>
          {selectedGroupId ? (
            <GroupDetailPanel
              groupId={selectedGroupId}
              allUsers={users}
              onBack={() => setSelectedGroupId(null)}
              onChanged={loadAll}
            />
          ) : (
            <>
              <Form className="settings-form">
                <FormGroup label="Name">
                  <TextInput
                    value={newGroup.name}
                    onChange={(_e, v) => setNewGroup({ ...newGroup, name: v })}
                  />
                </FormGroup>
                <FormGroup label="Description">
                  <TextInput
                    value={newGroup.description}
                    onChange={(_e, v) =>
                      setNewGroup({ ...newGroup, description: v })
                    }
                  />
                </FormGroup>
                <Button onClick={createGroup}>Create group</Button>
              </Form>
              <Table aria-label="Groups" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Description</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {groups.map((g) => (
                    <Tr
                      key={g.id}
                      className="settings-page__clickable-row"
                      onClick={() => setSelectedGroupId(g.id)}
                    >
                      <Td>
                        <Button variant="link" isInline>
                          {g.name}
                        </Button>
                      </Td>
                      <Td>{g.description || "—"}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </>
          )}
        </Tab>
        <Tab eventKey={2} title={<TabTitleText>Policies</TabTitleText>}>
          <p className="settings-page__hint">
            All group policies (read-only). Create or remove policies from a
            group&apos;s detail view on the Groups tab.
          </p>
          <Table aria-label="Policies" variant="compact">
            <Thead>
              <Tr>
                <Th>Group</Th>
                <Th>Cluster</Th>
                <Th>Permission</Th>
              </Tr>
            </Thead>
            <Tbody>
              {policies.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.group_name}</Td>
                  <Td>{p.cluster_key}</Td>
                  <Td>{p.permission}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Tab>
        <Tab eventKey={3} title={<TabTitleText>Kubeconfigs</TabTitleText>}>
          <FormGroup label="Upload kubeconfig">
            <input type="file" accept="*" onChange={uploadKubeconfig} />
          </FormGroup>
          <Table aria-label="Kubeconfigs">
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Cluster</Th>
              </Tr>
            </Thead>
            <Tbody>
              {kubeconfigs.map((k) => (
                <Tr key={k.id}>
                  <Td>{k.name}</Td>
                  <Td>{k.cluster_key}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Tab>
        <Tab eventKey={4} title={<TabTitleText>Audit</TabTitleText>}>
          <Table aria-label="Audit">
            <Thead>
              <Tr>
                <Th>Time</Th>
                <Th>User</Th>
                <Th>Action</Th>
                <Th>Resource</Th>
              </Tr>
            </Thead>
            <Tbody>
              {audit.map((ev) => (
                <Tr key={ev.id}>
                  <Td>{ev.created_at}</Td>
                  <Td>{ev.username || ev.user_id}</Td>
                  <Td>{ev.action}</Td>
                  <Td>
                    {ev.resource_type}:{ev.resource_id}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Tab>
      </Tabs>

      <Modal
        variant={ModalVariant.small}
        title={`Edit groups — ${editGroupsUser?.username || ""}`}
        isOpen={Boolean(editGroupsUser)}
        onClose={() => setEditGroupsUser(null)}
      >
        {groups.length === 0 ? (
          <p className="settings-page__hint">No groups available.</p>
        ) : (
          <div className="settings-page__group-checkboxes">
            {groups.map((g) => (
              <Checkbox
                key={g.id}
                id={`edit-user-group-${g.id}`}
                label={g.name}
                isChecked={editGroupIds.includes(g.id)}
                onChange={(_e, checked) => toggleEditGroup(g.id, checked)}
              />
            ))}
          </div>
        )}
        <div className="settings-page__modal-actions">
          <Button variant="link" onClick={() => setEditGroupsUser(null)}>
            Cancel
          </Button>
          <Button onClick={saveUserGroups}>Save</Button>
        </div>
      </Modal>
    </div>
  );
};

export default Settings;
