"""bin/join's reading of the tailnet: why Concierge can't be reached, and what to do about it. python3 bin/join_test.py"""
import importlib.machinery
import importlib.util
import os
import unittest

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'join')
spec = importlib.util.spec_from_loader('join', importlib.machinery.SourceFileLoader('join', path))
join = importlib.util.module_from_spec(spec)
spec.loader.exec_module(join)

peer = lambda name, tags=None: {'HostName': name, 'TailscaleIPs': ['100.64.0.1'], 'Online': True, 'Tags': tags or []}


class ExplainTailnet(unittest.TestCase):
    def test_found(self):
        out = join.explain_tailnet([peer('win', ['tag:concierge'])], {'win': 'concierge'})
        self.assertEqual([ok for ok, _, _ in out], [True])

    def test_nothing_tagged_means_the_main_machine_or_its_link_is_down(self):
        (ok, what, fix), = join.explain_tailnet([peer('phone')], {})
        self.assertFalse(ok)
        self.assertIn('tagged tag:concierge', what)
        self.assertIn('concierge-link', fix)

    def test_a_dropped_connection_is_the_policy_with_the_rule_to_add(self):
        (ok, what, fix), = join.explain_tailnet([peer('win', ['tag:concierge'])], {'win': 'timeout'})
        self.assertFalse(ok)
        self.assertIn('policy blocks it', fix)
        self.assertIn('"dst": ["tag:concierge:4748"]', fix)

    def test_a_refused_connection_is_concierge_not_running(self):
        (ok, _, fix), = join.explain_tailnet([peer('win', ['tag:concierge'])], {'win': 'refused'})
        self.assertFalse(ok)
        self.assertIn('not running', fix)

    def test_reach_tells_refused_from_timeout(self):
        import socket
        s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()  # nothing listens there now
        self.assertEqual(join.reach('127.0.0.1', port, timeout=2), 'refused')


if __name__ == '__main__':
    unittest.main()
